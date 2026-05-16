# @metxt/image-search-lab

Experimental package for testing public image discovery against a known image.

This is not a complete reverse-image search engine. It does two separate things:

1. Uses a text query, such as `pikachu`, to discover candidate image URLs.
2. Optionally scores downloaded candidates against your input image using a simple perceptual hash, if ImageMagick `convert` is installed.

## Usage

Put a data URI in a text file:

```sh
printf '%s' 'data:image/jpeg;base64,...' > /private/tmp/pikachu-data-uri.txt
```

Run a search:

```sh
npm run search --workspace=@metxt/image-search-lab -- \
  --query "pikachu" \
  --input-file /private/tmp/pikachu-data-uri.txt \
  --limit 12
```

The package writes results to `tmp/image-search-lab/results.json` by default. Each result includes:

- `title`
- `pageUrl`
- `imageUrl`
- `thumbnailUrl`
- `similarity`, when local scoring was possible

## Providers

The default provider is `ddg`, which uses DuckDuckGo image search endpoints and is best treated as a local experiment.

For a production feature, use a paid search API with explicit terms and stable quotas. The package includes a Brave Search adapter:

```sh
BRAVE_SEARCH_API_KEY=... npm run search --workspace=@metxt/image-search-lab -- \
  --provider brave \
  --query "pikachu" \
  --input-file /private/tmp/pikachu-data-uri.txt
```

## Local Scoring

If ImageMagick is available, candidate images are converted to 8x8 grayscale and compared with a 64-bit average hash. This is useful for rough near-duplicate sorting, not identity proof.

Set a custom binary with:

```sh
IMAGE_SEARCH_CONVERT_BIN=/opt/homebrew/bin/convert
```

