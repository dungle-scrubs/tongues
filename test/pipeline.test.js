import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+2KQAAAAASUVORK5CYII=";
const RENDERED_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAwUBAO+aR0wAAAAASUVORK5CYII=";

const state = {
	responses: /** @type {unknown[]} */ ([]),
	calls: /** @type {unknown[]} */ ([]),
	apiKeys: /** @type {string[]} */ ([]),
};

const createdDirs = /** @type {string[]} */ ([]);
const originalApiKey = process.env.GEMINI_API_KEY;

mock.module("@google/genai", () => ({
	GoogleGenAI: class {
		/**
		 * Create fake Gemini client that reads queued responses.
		 * @param {{ apiKey?: string }} options Constructor options.
		 */
		constructor(options = {}) {
			state.apiKeys.push(options.apiKey ?? "");
			this.models = {
				/**
				 * Return the next mocked response.
				 * @param {unknown} request Model request payload.
				 * @returns {Promise<unknown>} Mocked model response.
				 */
				generateContent: async (request) => {
					state.calls.push(request);
					const next = state.responses.shift();
					if (next instanceof Error) throw next;
					return next ?? { text: "[]" };
				},
			};
		}
	},
	Modality: { IMAGE: "IMAGE" },
}));

const pipeline = await import("../src/pipeline.js");

/**
 * Reset mocked client state between tests.
 * @returns {void}
 */
function resetState() {
	state.responses.length = 0;
	state.calls.length = 0;
	state.apiKeys.length = 0;
}

/**
 * Create a temporary PNG image for test input.
 * @param {string=} name File name.
 * @param {string=} base64 Base64 file contents.
 * @returns {Promise<string>} Absolute path to created file.
 */
async function createTempImage(
	name = "input.png",
	base64 = ONE_PIXEL_PNG_BASE64,
) {
	const dir = await mkdtemp(path.join(tmpdir(), "tongues-image-"));
	createdDirs.push(dir);
	const filePath = path.join(dir, name);
	await writeFile(filePath, Buffer.from(base64, "base64"));
	return filePath;
}

/**
 * Queue fake model responses in order of invocation.
 * @param {unknown[]} responses Response objects.
 * @returns {void}
 */
function queueResponses(...responses) {
	state.responses.push(...responses);
}

beforeEach(() => {
	resetState();
	delete process.env.GEMINI_API_KEY;
});

afterEach(async () => {
	const pending = createdDirs.splice(0, createdDirs.length);
	await Promise.all(
		pending.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

afterAll(() => {
	if (originalApiKey === undefined) {
		delete process.env.GEMINI_API_KEY;
		return;
	}

	process.env.GEMINI_API_KEY = originalApiKey;
});

describe("pipeline helpers", () => {
	test("parseJsonArray handles fenced JSON", () => {
		const parsed = pipeline.__test.parseJsonArray(
			'```json\n[{"text":"hola"}]\n```',
		);
		expect(parsed).toEqual([{ text: "hola" }]);
	});

	test("parseJsonArray throws for invalid output", () => {
		expect(() => pipeline.__test.parseJsonArray("nonsense")).toThrow(
			"Model output did not contain a valid JSON array.",
		);
	});

	test("inferMimeType supports image extensions and rejects others", () => {
		expect(pipeline.__test.inferMimeType("/tmp/a.png")).toBe("image/png");
		expect(pipeline.__test.inferMimeType("/tmp/a.jpg")).toBe("image/jpeg");
		expect(pipeline.__test.inferMimeType("/tmp/a.webp")).toBe("image/webp");
		expect(pipeline.__test.inferMimeType("/tmp/a.heic")).toBe("image/heic");
		expect(() => pipeline.__test.inferMimeType("/tmp/a.gif")).toThrow(
			"Unsupported image extension",
		);
	});

	test("defaultOutputPath appends _translated suffix", () => {
		expect(pipeline.__test.defaultOutputPath("/tmp/menu.jpg")).toBe(
			"/tmp/menu_translated.jpg",
		);
	});
});

describe("pipeline behavior", () => {
	test("extractAndTranslateText returns translated rows", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();

		queueResponses(
			{ text: '[{"text":"こんにちは","language":"ja"}]' },
			{ text: '[{"index":0,"translation":"hello"}]' },
		);

		const rows = await pipeline.extractAndTranslateText({ inputPath });

		expect(rows).toEqual([
			{
				sourceText: "こんにちは",
				sourceLanguage: "ja",
				translatedText: "hello",
			},
		]);
		expect(state.apiKeys).toEqual(["test-key"]);
		expect(state.calls).toHaveLength(2);
	});

	test("recreateImageWithTranslatedText copies input when extraction is empty", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();
		const outputPath = inputPath.replace("input.png", "out.png");

		queueResponses({ text: "[]" });

		const writtenPath = await pipeline.recreateImageWithTranslatedText({
			inputPath,
			outputPath,
		});
		const sourceBuffer = await readFile(inputPath);
		const outputBuffer = await readFile(writtenPath);

		expect(writtenPath).toBe(outputPath);
		expect(outputBuffer.equals(sourceBuffer)).toBe(true);
		expect(state.calls).toHaveLength(1);
	});

	test("recreateImageWithTranslatedText writes rendered image when text exists", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();
		const outputPath = inputPath.replace("input.png", "translated.png");

		queueResponses(
			{ text: '[{"text":"hola","language":"es"}]' },
			{ text: '[{"index":0,"translation":"hello"}]' },
			{
				candidates: [
					{
						content: {
							parts: [{ inlineData: { data: RENDERED_PNG_BASE64 } }],
						},
					},
				],
			},
		);

		await pipeline.recreateImageWithTranslatedText({ inputPath, outputPath });
		const outputBuffer = await readFile(outputPath);

		expect(
			outputBuffer.equals(Buffer.from(RENDERED_PNG_BASE64, "base64")),
		).toBe(true);
		expect(state.calls).toHaveLength(3);
	});

	test("throws when output exists and force is false", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();
		const outputPath = inputPath.replace("input.png", "exists.png");
		await writeFile(outputPath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

		await expect(
			pipeline.recreateImageWithTranslatedText({ inputPath, outputPath }),
		).rejects.toThrow("Output file already exists");
		expect(state.calls).toHaveLength(0);
	});

	test("overwrites existing output when force is true", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();
		const outputPath = inputPath.replace("input.png", "exists.png");
		await writeFile(outputPath, Buffer.from("placeholder"));

		queueResponses({ text: "[]" });

		await pipeline.recreateImageWithTranslatedText({
			inputPath,
			outputPath,
			force: true,
		});

		const sourceBuffer = await readFile(inputPath);
		const outputBuffer = await readFile(outputPath);
		expect(outputBuffer.equals(sourceBuffer)).toBe(true);
	});

	test("throws when API key is missing", async () => {
		const inputPath = await createTempImage();

		await expect(
			pipeline.extractAndTranslateText({ inputPath }),
		).rejects.toThrow("GEMINI_API_KEY is required");
	});

	test("throws when translation output is not valid JSON", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();

		queueResponses(
			{ text: '[{"text":"hola","language":"es"}]' },
			{ text: "not-json" },
		);

		await expect(
			pipeline.extractAndTranslateText({ inputPath }),
		).rejects.toThrow("Model output did not contain a valid JSON array.");
	});

	test("throws when render response has no image payload", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		const inputPath = await createTempImage();

		queueResponses(
			{ text: '[{"text":"hola","language":"es"}]' },
			{ text: '[{"index":0,"translation":"hello"}]' },
			{ candidates: [{ content: { parts: [] } }] },
		);

		await expect(
			pipeline.recreateImageWithTranslatedText({ inputPath }),
		).rejects.toThrow("Gemini did not return an image.");
	});
});
