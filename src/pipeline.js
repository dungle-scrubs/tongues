import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Modality } from "@google/genai";

const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_TEXT_MODEL = "gemini-3-pro-preview";
const SUPPORTED_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".heic",
]);

/**
 * Shared CLI defaults.
 */
export const DEFAULTS = {
	inputLang: "auto",
	outputLang: "english",
	imageModel: DEFAULT_IMAGE_MODEL,
	textModel: DEFAULT_TEXT_MODEL,
};

/**
 * @typedef {object} TranslateRequest
 * @property {string} inputPath Input image path.
 * @property {string=} outputPath Output image path.
 * @property {string=} inputLang Source language or "auto".
 * @property {string=} outputLang Target language.
 * @property {string=} apiKey Gemini API key.
 * @property {string=} imageModel Gemini image model for extraction/rendering.
 * @property {string=} textModel Gemini text model for translation.
 * @property {boolean=} force Overwrite an existing output file.
 */

/**
 * @typedef {object} ExtractedEntry
 * @property {string} text Original text found in the image.
 * @property {string=} language Source language if detected.
 */

/**
 * @typedef {object} ExtractedTranslation
 * @property {string} sourceText Original text found in the image.
 * @property {string=} sourceLanguage Source language if detected.
 * @property {string} translatedText Translated text.
 */

/**
 * Resolve the Gemini API key from explicit input or environment.
 * @param {string|undefined} explicitApiKey Explicit CLI API key.
 * @returns {string} API key to use.
 * @throws {Error} When no API key is available.
 */
function resolveApiKey(explicitApiKey) {
	const key = explicitApiKey ?? process.env.GEMINI_API_KEY;
	if (!key) {
		throw new Error("GEMINI_API_KEY is required. Set it or pass --api-key.");
	}
	return key;
}

/**
 * Ensure an input file exists.
 * @param {string} filePath Path to validate.
 * @returns {Promise<void>} Resolves when file exists.
 * @throws {Error} When file cannot be accessed.
 */
async function ensureFileExists(filePath) {
	try {
		await access(filePath);
	} catch {
		throw new Error(`Input file not found: ${filePath}`);
	}
}

/**
 * Ensure output path is writable when overwrite is disabled.
 * @param {string} outputPath Output file path.
 * @param {boolean} force Whether overwrite is allowed.
 * @returns {Promise<void>} Resolves when write can proceed.
 * @throws {Error} When output exists and force is false.
 */
async function ensureOutputWritable(outputPath, force) {
	if (force) return;

	try {
		await stat(outputPath);
		throw new Error(
			`Output file already exists: ${outputPath}. Use --force to overwrite.`,
		);
	} catch (error) {
		if (error instanceof Error && error.message.includes("already exists")) {
			throw error;
		}
	}
}

/**
 * Infer MIME type from image extension.
 * @param {string} filePath Input image path.
 * @returns {string} MIME type for Gemini inline data.
 * @throws {Error} When extension is unsupported.
 */
function inferMimeType(filePath) {
	const extension = path.extname(filePath).toLowerCase();
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		throw new Error(`Unsupported image extension: ${extension || "(none)"}`);
	}

	if (extension === ".png") return "image/png";
	if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
	if (extension === ".webp") return "image/webp";
	return "image/heic";
}

/**
 * Read an image and return inline data for Gemini requests.
 * @param {string} inputPath Input image path.
 * @returns {Promise<{ data: string, mimeType: string }>} Inline image payload.
 */
async function readInlineImage(inputPath) {
	const mimeType = inferMimeType(inputPath);
	const data = (await readFile(inputPath)).toString("base64");
	return { data, mimeType };
}

/**
 * Parse a JSON array from model output.
 * @param {string} rawText Model text output.
 * @returns {unknown[]} Parsed JSON array.
 * @throws {Error} When no valid JSON array exists.
 */
function parseJsonArray(rawText) {
	const text = rawText.trim();
	const unfenced = text
		.replace(/^```json\s*/i, "")
		.replace(/```$/i, "")
		.trim();

	try {
		const parsed = JSON.parse(unfenced);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		// Fall through to bracket extraction.
	}

	const start = unfenced.indexOf("[");
	const end = unfenced.lastIndexOf("]");
	if (start !== -1 && end > start) {
		const slice = unfenced.slice(start, end + 1);
		const parsed = JSON.parse(slice);
		if (Array.isArray(parsed)) return parsed;
	}

	throw new Error("Model output did not contain a valid JSON array.");
}

/**
 * Extract visible text from an image using Gemini multimodal input.
 * @param {{ ai: GoogleGenAI, imageModel: string, inlineImage: { data: string, mimeType: string } }} params Extraction request values.
 * @returns {Promise<ExtractedEntry[]>} Extracted text entries.
 */
async function extractTextEntries(params) {
	const prompt = [
		"Extract every visible text segment from this image.",
		"Return only JSON array items with keys: text, language.",
		"language should be ISO 639-1 when possible.",
		"If nothing is found, return an empty array.",
	].join(" ");

	const response = await params.ai.models.generateContent({
		model: params.imageModel,
		contents: [
			{
				parts: [{ inlineData: params.inlineImage }, { text: prompt }],
			},
		],
	});

	const rawItems = parseJsonArray(response.text ?? "");
	return rawItems
		.map((item) => {
			const row = /** @type {Record<string, unknown>} */ (item ?? {});
			return {
				text: typeof row.text === "string" ? row.text.trim() : "",
				language: typeof row.language === "string" ? row.language : undefined,
			};
		})
		.filter((item) => item.text.length > 0);
}

/**
 * Translate extracted entries to the requested output language.
 * @param {{ ai: GoogleGenAI, textModel: string, inputLang: string, outputLang: string, entries: ExtractedEntry[] }} params Translation request values.
 * @returns {Promise<string[]>} Translated text values aligned by index.
 */
async function translateEntries(params) {
	if (params.entries.length === 0) return [];

	const payload = params.entries.map((entry, index) => ({
		index,
		text: entry.text,
		language: entry.language,
	}));

	const sourceInstruction =
		params.inputLang.toLowerCase() === "auto"
			? "Auto-detect source language per entry."
			: `Source language for all entries: ${params.inputLang}.`;

	const prompt = [
		`Translate each item into ${params.outputLang}.`,
		sourceInstruction,
		"Return only a JSON array with objects: { index, translation }.",
		"Preserve meaning and tone.",
	].join(" ");

	const response = await params.ai.models.generateContent({
		model: params.textModel,
		contents: [
			{ parts: [{ text: `${prompt}\n\n${JSON.stringify(payload)}` }] },
		],
	});

	const rawItems = parseJsonArray(response.text ?? "");
	const output = Array(params.entries.length).fill("");

	for (const item of rawItems) {
		const row = /** @type {Record<string, unknown>} */ (item ?? {});
		if (typeof row.index !== "number") continue;
		if (row.index < 0 || row.index >= output.length) continue;
		output[row.index] =
			typeof row.translation === "string" ? row.translation : "";
	}

	return output.map((value, index) => value || params.entries[index].text);
}

/**
 * Render a translated image using text mapping instructions.
 * @param {{ ai: GoogleGenAI, imageModel: string, outputLang: string, inlineImage: { data: string, mimeType: string }, entries: ExtractedEntry[], translations: string[] }} params Render request values.
 * @returns {Promise<string>} Base64 output image.
 * @throws {Error} When image data is missing in the response.
 */
async function renderImage(params) {
	const mapping = params.entries.map((entry, index) => ({
		source: entry.text,
		translation: params.translations[index] ?? entry.text,
	}));

	const prompt = [
		`Recreate this image with text translated to ${params.outputLang}.`,
		"Replace only text. Keep layout, style, and non-text pixels unchanged.",
		`Use this exact mapping JSON: ${JSON.stringify(mapping)}`,
	].join(" ");

	const response = await params.ai.models.generateContent({
		model: params.imageModel,
		contents: [
			{
				parts: [{ inlineData: params.inlineImage }, { text: prompt }],
			},
		],
		config: {
			responseModalities: [Modality.IMAGE],
		},
	});

	const parts = response.candidates?.[0]?.content?.parts ?? [];
	const imagePart = parts.find((part) => part.inlineData?.data);
	if (!imagePart?.inlineData?.data) {
		throw new Error("Gemini did not return an image.");
	}

	return imagePart.inlineData.data;
}

/**
 * Create a default output image path.
 * @param {string} inputPath Input image path.
 * @returns {string} Derived output image path.
 */
function defaultOutputPath(inputPath) {
	const extension = path.extname(inputPath);
	const baseName = path.basename(inputPath, extension);
	return path.join(
		path.dirname(inputPath),
		`${baseName}_translated${extension}`,
	);
}

/**
 * Recreate an image using translated text.
 * @param {TranslateRequest} request Translation request.
 * @returns {Promise<string>} Output image path.
 */
export async function recreateImageWithTranslatedText(request) {
	await ensureFileExists(request.inputPath);

	const outputPath = request.outputPath ?? defaultOutputPath(request.inputPath);
	await ensureOutputWritable(outputPath, request.force ?? false);

	const inlineImage = await readInlineImage(request.inputPath);
	const ai = new GoogleGenAI({ apiKey: resolveApiKey(request.apiKey) });
	const inputLang = request.inputLang ?? DEFAULTS.inputLang;
	const outputLang = request.outputLang ?? DEFAULTS.outputLang;
	const imageModel = request.imageModel ?? DEFAULTS.imageModel;
	const textModel = request.textModel ?? DEFAULTS.textModel;

	const entries = await extractTextEntries({ ai, imageModel, inlineImage });
	const translations = await translateEntries({
		ai,
		textModel,
		inputLang,
		outputLang,
		entries,
	});

	const outputBase64 =
		entries.length === 0
			? inlineImage.data
			: await renderImage({
					ai,
					imageModel,
					outputLang,
					inlineImage,
					entries,
					translations,
				});

	await writeFile(outputPath, Buffer.from(outputBase64, "base64"));
	return outputPath;
}

/**
 * Extract text from an image and return translated entries.
 * @param {TranslateRequest} request Extraction request.
 * @returns {Promise<ExtractedTranslation[]>} Extracted+translated rows.
 */
export async function extractAndTranslateText(request) {
	await ensureFileExists(request.inputPath);

	const inlineImage = await readInlineImage(request.inputPath);
	const ai = new GoogleGenAI({ apiKey: resolveApiKey(request.apiKey) });
	const inputLang = request.inputLang ?? DEFAULTS.inputLang;
	const outputLang = request.outputLang ?? DEFAULTS.outputLang;
	const imageModel = request.imageModel ?? DEFAULTS.imageModel;
	const textModel = request.textModel ?? DEFAULTS.textModel;

	const entries = await extractTextEntries({ ai, imageModel, inlineImage });
	const translations = await translateEntries({
		ai,
		textModel,
		inputLang,
		outputLang,
		entries,
	});

	return entries.map((entry, index) => ({
		sourceText: entry.text,
		sourceLanguage: entry.language,
		translatedText: translations[index] ?? entry.text,
	}));
}

/**
 * Test-only hooks for deterministic unit testing of pure helpers.
 */
export const __test = {
	defaultOutputPath,
	inferMimeType,
	parseJsonArray,
};
