# image-processing

## Description

Image/video manipulation, rendering, visual processing

## Methodology

SSIM/PSNR metrics, visual diff, perceptual quality

## Phase Intelligence

### plan

- **Collection Direction**: Pipeline architecture, color space theory, format specs, quality metrics
- **Key Sources**: ImageMagick/ffmpeg docs, ICC spec, image format RFCs, academic papers on SSIM/PSNR
- **Plan Structure**: Pipeline design → stage parameters → quality metrics → validation
- **Key Considerations**: Color space handling, format compatibility, reference images, visual quality thresholds (SSIM/PSNR)

### verify

- **Collection Direction**: Visual quality metrics, reference image generation, perceptual testing
- **Key Sources**: SSIM/PSNR libraries, OpenCV test utilities, ICC profile validators, exiftool
- **Quick Checkpoint**: File format valid, dimensions correct, no corruption
- **Full Checkpoint**: SSIM/PSNR against reference images, color space validation, metadata integrity, batch consistency
- **Key Tools**: `imagemagick compare`, `ffprobe`, `python PIL/skimage.metrics`, `exiftool`

### check

- **Collection Direction**: Visual quality standards, format compliance specs, industry acceptance criteria
- **Key Sources**: ICC standards, image format specs (JPEG/PNG/WebP), broadcast color standards
- **Indicators**: Image, render, thumbnail, filter
- **Verification Approach**: Visual diff (SSIM/PSNR), reference image comparison, format validation, metadata checks

### exec

- **Collection Direction**: Tool CLI syntax, API reference, format conversion recipes, optimization techniques
- **Key Sources**: ImageMagick/ffmpeg CLI docs, PIL/OpenCV API, format-specific encoding guides
- **Implementation Approach**: Invoke image processing tools (ImageMagick, ffmpeg, PIL, etc.), generate/compare visual outputs
- **Step Verification**: Visual diff (SSIM/PSNR), reference image comparison, metadata validation
