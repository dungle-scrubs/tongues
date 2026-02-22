import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_FILE_BYTES = 1_000_000;
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 640;

/**
 * Parse CLI arguments.
 * @param {string[]} argv Raw argv without node/tsx binary.
 * @returns {{ input: string; output: string }} Parsed paths.
 * @throws {Error} When required args are missing.
 */
function parseArgs(argv: string[]): { input: string; output: string } {
	let input = "";
	let output = "";

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--input") {
			input = argv[index + 1] ?? "";
			index += 1;
			continue;
		}

		if (token === "--output") {
			output = argv[index + 1] ?? "";
			index += 1;
		}
	}

	if (!input || !output) {
		throw new Error(
			"Usage: npx tsx ./scripts/finalize-social-share.ts --input <path> --output <path>",
		);
	}

	if (path.extname(output).toLowerCase() !== ".png") {
		throw new Error("Output must be a .png file.");
	}

	return { input, output };
}

/**
 * Run sips with args.
 * @param {string[]} args sips args.
 * @returns {string} UTF-8 output.
 */
function runSips(args: string[]): string {
	return execFileSync("sips", args, { encoding: "utf8" });
}

/**
 * Ensure sips exists.
 * @returns {void}
 * @throws {Error} When sips is unavailable.
 */
function ensureSips(): void {
	try {
		runSips(["--help"]);
	} catch {
		throw new Error("sips is required but not available on this system.");
	}
}

/**
 * Read dimensions from image metadata.
 * @param {string} filePath Image path.
 * @returns {{ width: number; height: number }} Parsed width/height.
 */
function getDimensions(filePath: string): { width: number; height: number } {
	const output = runSips(["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
	const widthMatch = output.match(/pixelWidth:\s*(\d+)/);
	const heightMatch = output.match(/pixelHeight:\s*(\d+)/);

	const width = Number(widthMatch?.[1] ?? 0);
	const height = Number(heightMatch?.[1] ?? 0);

	if (!width || !height) {
		throw new Error(`Unable to read dimensions for ${filePath}`);
	}

	return { width, height };
}

/**
 * Compute centered crop rectangle preserving 2:1 target ratio.
 * @param {{ width: number; height: number }} size Source size.
 * @returns {{ cropWidth: number; cropHeight: number }} Crop dimensions.
 */
function getCropSize(size: { width: number; height: number }): {
	cropWidth: number;
	cropHeight: number;
} {
	const sourceRatio = size.width / size.height;
	const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;

	if (sourceRatio > targetRatio) {
		return {
			cropWidth: Math.round(size.height * targetRatio),
			cropHeight: size.height,
		};
	}

	return {
		cropWidth: size.width,
		cropHeight: Math.round(size.width / targetRatio),
	};
}

/**
 * Validate final dimensions and size constraints.
 * @param {string} outputPath Final output path.
 * @returns {void}
 */
function validateOutput(outputPath: string): void {
	const { width, height } = getDimensions(outputPath);
	if (width !== TARGET_WIDTH || height !== TARGET_HEIGHT) {
		throw new Error(
			`social-share.png must be ${TARGET_WIDTH}x${TARGET_HEIGHT}, got ${width}x${height}`,
		);
	}

	const { size } = statSync(outputPath);
	if (size >= MAX_FILE_BYTES) {
		throw new Error(
			`social-share.png must be under 1MB. Current size: ${size} bytes`,
		);
	}
}

/**
 * Finalize social image to exact GitHub social preview requirements.
 * @returns {void}
 */
function main(): void {
	const { input, output } = parseArgs(process.argv.slice(2));
	ensureSips();
	mkdirSync(path.dirname(output), { recursive: true });

	const size = getDimensions(input);
	const crop = getCropSize(size);
	const tempDir = mkdtempSync(path.join(tmpdir(), "finalize-social-share-"));
	const croppedPath = path.join(tempDir, "cropped.png");

	try {
		runSips([
			"--cropToHeightWidth",
			String(crop.cropHeight),
			String(crop.cropWidth),
			input,
			"--out",
			croppedPath,
		]);
		runSips([
			"-s",
			"format",
			"png",
			"-z",
			String(TARGET_HEIGHT),
			String(TARGET_WIDTH),
			croppedPath,
			"--out",
			output,
		]);
		validateOutput(output);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

main();
