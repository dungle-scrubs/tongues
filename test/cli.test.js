import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { createProgram, runCommand } from "../src/cli.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const restored = /** @type {Array<() => void>} */ ([]);

/**
 * Create a complete options object for runCommand tests.
 * @param {Partial<{
 *   output?: string,
 *   extract: boolean,
 *   force: boolean,
 *   inputLang: string,
 *   outputLang: string,
 *   apiKey?: string,
 *   imageModel: string,
 *   textModel: string
 * }>=} overrides Option overrides.
 * @returns {{
 *   output?: string,
 *   extract: boolean,
 *   force: boolean,
 *   inputLang: string,
 *   outputLang: string,
 *   apiKey?: string,
 *   imageModel: string,
 *   textModel: string
 * }} Full option set.
 */
function makeOptions(overrides = {}) {
	return {
		output: undefined,
		extract: false,
		force: false,
		inputLang: "auto",
		outputLang: "english",
		apiKey: "test-key",
		imageModel: "gemini-3-pro-image-preview",
		textModel: "gemini-3-pro-preview",
		...overrides,
	};
}

/**
 * Replace console.log with a recorder for deterministic assertions.
 * @returns {unknown[][]} Captured console.log argument lists.
 */
function captureConsoleLog() {
	const calls = /** @type {unknown[][]} */ ([]);
	const originalLog = console.log;

	console.log = (...args) => {
		calls.push(args);
	};

	restored.push(() => {
		console.log = originalLog;
	});

	return calls;
}

/**
 * Run the CLI in a subprocess and capture output.
 * @param {string[]} args CLI arguments.
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>} Process result.
 */
async function runCli(args) {
	const processHandle = Bun.spawn(["bun", "src/cli.js", ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
	]);

	return { exitCode, stdout, stderr };
}

afterEach(() => {
	for (const restore of restored.splice(0, restored.length)) {
		restore();
	}
});

describe("CLI configuration", () => {
	test("uses required defaults", () => {
		const program = createProgram({
			extractAndTranslateText: async () => [],
			recreateImageWithTranslatedText: async () => "/tmp/out.png",
		});

		const inputLangOption = program.options.find(
			(option) => option.long === "--input-lang",
		);
		const outputLangOption = program.options.find(
			(option) => option.long === "--output-lang",
		);
		const extractOption = program.options.find(
			(option) => option.long === "--extract",
		);

		expect(inputLangOption?.defaultValue).toBe("auto");
		expect(outputLangOption?.defaultValue).toBe("english");
		expect(extractOption?.defaultValue).toBe(false);
	});
});

describe("runCommand", () => {
	test("routes to extract handler in extract mode", async () => {
		const logs = captureConsoleLog();
		const calls = {
			extract: /** @type {unknown[]} */ ([]),
			recreate: /** @type {unknown[]} */ ([]),
		};

		const handlers = {
			/**
			 * Fake extract handler.
			 * @param {unknown} request Request payload.
			 * @returns {Promise<Array<{ sourceText: string, sourceLanguage: string, translatedText: string }>>}
			 */
			extractAndTranslateText: async (request) => {
				calls.extract.push(request);
				return [
					{ sourceText: "hola", sourceLanguage: "es", translatedText: "hello" },
				];
			},
			/**
			 * Fake recreate handler.
			 * @param {unknown} request Request payload.
			 * @returns {Promise<string>} Output path.
			 */
			recreateImageWithTranslatedText: async (request) => {
				calls.recreate.push(request);
				return "/tmp/out.png";
			},
		};

		await runCommand(
			"/tmp/input.png",
			makeOptions({ extract: true }),
			handlers,
		);

		expect(calls.extract.length).toBe(1);
		expect(calls.recreate.length).toBe(0);
		expect(logs.length).toBe(1);
		expect(String(logs[0]?.[0] ?? "")).toContain('"translatedText": "hello"');
	});

	test("routes to recreate handler in render mode and passes force", async () => {
		const logs = captureConsoleLog();
		const calls = {
			extract: /** @type {unknown[]} */ ([]),
			recreate: /** @type {unknown[]} */ ([]),
		};

		const handlers = {
			/**
			 * Fake extract handler.
			 * @param {unknown} request Request payload.
			 * @returns {Promise<[]>} Empty rows.
			 */
			extractAndTranslateText: async (request) => {
				calls.extract.push(request);
				return [];
			},
			/**
			 * Fake recreate handler.
			 * @param {unknown} request Request payload.
			 * @returns {Promise<string>} Output path.
			 */
			recreateImageWithTranslatedText: async (request) => {
				calls.recreate.push(request);
				return "/tmp/output.png";
			},
		};

		await runCommand(
			"/tmp/input.png",
			makeOptions({ force: true, output: "/tmp/output.png" }),
			handlers,
		);

		expect(calls.recreate.length).toBe(1);
		expect(calls.extract.length).toBe(0);
		expect(calls.recreate[0]).toMatchObject({
			inputPath: "/tmp/input.png",
			outputPath: "/tmp/output.png",
			force: true,
			inputLang: "auto",
			outputLang: "english",
		});
		expect(logs[0]).toEqual(["/tmp/output.png"]);
	});
});

describe("CLI subprocess", () => {
	test("prints help with defaults", async () => {
		const result = await runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("--input-lang <lang>");
		expect(result.stdout).toContain("default: auto");
		expect(result.stdout).toContain("--output-lang <lang>");
		expect(result.stdout).toContain("default: english");
	});

	test("returns non-zero and error message for missing file", async () => {
		const result = await runCli(["./missing.png"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Input file not found");
	});
});
