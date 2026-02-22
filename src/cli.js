#!/usr/bin/env bun
import { Command } from "commander";
import {
	DEFAULTS,
	extractAndTranslateText,
	recreateImageWithTranslatedText,
} from "./pipeline.js";

/**
 * @typedef {{
 *   extractAndTranslateText: typeof extractAndTranslateText,
 *   recreateImageWithTranslatedText: typeof recreateImageWithTranslatedText
 * }} CommandHandlers
 */

/**
 * @typedef {{
 *   output?: string,
 *   extract: boolean,
 *   force: boolean,
 *   inputLang: string,
 *   outputLang: string,
 *   apiKey?: string,
 *   imageModel: string,
 *   textModel: string
 * }} CliOptions
 */

/**
 * Build the CLI program instance.
 * @param {CommandHandlers=} handlers Optional handlers for test injection.
 * @returns {Command} Configured commander program.
 */
export function createProgram(
	handlers = { extractAndTranslateText, recreateImageWithTranslatedText },
) {
	const program = new Command();

	program
		.name("tongues-image")
		.description(
			"Recreate images with translated text, or extract text and translate without rendering.",
		)
		.argument("<input>", "Path to the input image")
		.option("-o, --output <path>", "Output path for the translated image")
		.option("--extract", "Only extract and translate text (prints JSON)", false)
		.option("--force", "Overwrite existing output image", false)
		.option(
			"--input-lang <lang>",
			"Input/source language (default: auto)",
			DEFAULTS.inputLang,
		)
		.option(
			"--output-lang <lang>",
			"Output/target language (default: english)",
			DEFAULTS.outputLang,
		)
		.option("--api-key <key>", "Gemini API key (defaults to GEMINI_API_KEY)")
		.option(
			"--image-model <model>",
			"Gemini image model used for extraction and rendering",
			DEFAULTS.imageModel,
		)
		.option(
			"--text-model <model>",
			"Gemini text model used for translation",
			DEFAULTS.textModel,
		)
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  tongues-image ./menu-jp.png",
				"  tongues-image ./menu-jp.png --output ./menu-en.png --output-lang english",
				"  tongues-image ./menu-jp.png --extract --input-lang auto --output-lang english",
			].join("\n"),
		)
		.action((inputPath, options) => runCommand(inputPath, options, handlers));

	return program;
}

/**
 * Run the selected CLI operation.
 * @param {string} inputPath Input image path.
 * @param {CliOptions} options Commander options.
 * @param {CommandHandlers=} handlers Optional handlers for test injection.
 * @returns {Promise<void>} CLI task completion.
 */
export async function runCommand(
	inputPath,
	options,
	handlers = { extractAndTranslateText, recreateImageWithTranslatedText },
) {
	if (options.extract) {
		const rows = await handlers.extractAndTranslateText({
			inputPath,
			inputLang: options.inputLang,
			outputLang: options.outputLang,
			apiKey: options.apiKey,
			imageModel: options.imageModel,
			textModel: options.textModel,
		});

		console.log(JSON.stringify(rows, null, 2));
		return;
	}

	const outputPath = await handlers.recreateImageWithTranslatedText({
		inputPath,
		outputPath: options.output,
		force: options.force,
		inputLang: options.inputLang,
		outputLang: options.outputLang,
		apiKey: options.apiKey,
		imageModel: options.imageModel,
		textModel: options.textModel,
	});

	console.log(outputPath);
}

/**
 * Execute the CLI and map errors to non-zero exit code.
 * @param {string[]=} argv Command-line arguments.
 * @returns {Promise<void>} Program completion.
 */
export async function main(argv = process.argv) {
	const program = createProgram();
	await program.parseAsync(argv);
}

if (import.meta.main) {
	main().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	});
}
