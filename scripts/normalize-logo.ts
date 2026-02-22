import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * @typedef {{ input: string; output: string }} CliArgs
 */

/**
 * Parse CLI arguments.
 * @param {string[]} argv Raw argv without node/tsx binary.
 * @returns {CliArgs} Parsed input and output paths.
 * @throws {Error} If required flags are missing.
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
			"Usage: npx tsx ./scripts/normalize-logo.ts --input <path> --output <path>",
		);
	}

	if (path.extname(output).toLowerCase() !== ".png") {
		throw new Error("Output must be a .png file.");
	}

	return { input, output };
}

/**
 * Run sips with the provided arguments.
 * @param {string[]} args sips arguments.
 * @returns {string} UTF-8 command output.
 */
function runSips(args: string[]): string {
	return execFileSync("sips", args, { encoding: "utf8" });
}

/**
 * Ensure sips is available.
 * @returns {void}
 * @throws {Error} If sips is unavailable.
 */
function ensureSips(): void {
	try {
		runSips(["--help"]);
	} catch {
		throw new Error("sips is required but not available on this system.");
	}
}

/**
 * Read image dimensions using sips metadata output.
 * @param {string} filePath Image file path.
 * @returns {{ width: number; height: number }} Image dimensions.
 * @throws {Error} If dimensions cannot be parsed.
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
 * Assert output is exactly 1000x1000.
 * @param {string} filePath Output path.
 * @returns {void}
 * @throws {Error} If dimensions are not 1000x1000.
 */
function assertOutputSize(filePath: string): void {
	const { width, height } = getDimensions(filePath);
	if (width !== 1000 || height !== 1000) {
		throw new Error(
			`Normalized logo must be 1000x1000, got ${width}x${height}`,
		);
	}
}

/**
 * Normalize any image to centered 1000x1000 PNG.
 * @returns {void}
 */
function main(): void {
	const { input, output } = parseArgs(process.argv.slice(2));
	ensureSips();
	mkdirSync(path.dirname(output), { recursive: true });

	const { width, height } = getDimensions(input);
	const crop = Math.min(width, height);
	const tempDir = mkdtempSync(path.join(tmpdir(), "normalize-logo-"));
	const croppedPath = path.join(tempDir, "cropped.png");

	try {
		runSips([
			"--cropToHeightWidth",
			String(crop),
			String(crop),
			input,
			"--out",
			croppedPath,
		]);
		runSips([
			"-s",
			"format",
			"png",
			"-z",
			"1000",
			"1000",
			croppedPath,
			"--out",
			output,
		]);
		assertOutputSize(output);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

main();
