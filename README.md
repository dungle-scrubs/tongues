# tongues

CLI for translating non-English text inside images.

It supports two operations:

- recreate the image with translated text in place
- extract text and return translated output as JSON

## Features

- Commander-based CLI
- `--input-lang` defaults to `auto`
- `--output-lang` defaults to `english`
- Gemini-powered OCR + translation + image recreation
- Extract mode for automation pipelines (`--extract`)

## Requirements

- Bun 1.2+
- Node.js 22+ (for publish and CI compatibility)
- `GEMINI_API_KEY` set in the environment or passed via `--api-key`

## Installation

### From npm

```bash
npm install -g @dungle-scrubs/tongues
```

### From source

```bash
bun install
```

## Configuration

```bash
export GEMINI_API_KEY="your-api-key"
```

## Usage

```bash
# Recreate image with translated text (writes *_translated.ext by default)
tongues ./input.jpg

# Recreate image with explicit output file
tongues ./input.jpg --output ./output.jpg --output-lang english

# Extract and translate text only
tongues ./input.jpg --extract
```

### Options

```text
-o, --output <path>        Output path for recreated image
--extract                  Extract + translate text only
--force                    Overwrite existing output image
--input-lang <lang>        Input/source language (default: auto)
--output-lang <lang>       Output/target language (default: english)
--api-key <key>            Gemini API key (fallback: GEMINI_API_KEY)
--image-model <model>      Gemini image model for extraction/rendering
--text-model <model>       Gemini text model for translation
```

## Development

```bash
bun run format
bun run lint
bun run typecheck
bun test
```

## Known limitations

- Render quality depends on model output
- Complex layouts with overlapping text may not preserve perfect typography

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

MIT - see [LICENSE](./LICENSE).
