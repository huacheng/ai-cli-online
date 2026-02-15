# video-production

## Description

Video editing, compositing, VFX, motion graphics

## Methodology

Frame analysis, render quality, timeline verification

## Phase Intelligence

### plan

- **Collection Direction**: Timeline architecture, codec selection, color science, industry workflows
- **Key Sources**: ffmpeg wiki, DaVinci Resolve docs, broadcast standards (ITU-R BT.709/2020), NAB best practices
- **Plan Structure**: Timeline → sequence assembly → effects chain → render settings → output validation
- **Key Considerations**: Codec selection, frame rate consistency, color grading pipeline, audio sync, format compliance

### verify

- **Collection Direction**: Frame comparison tools, codec compliance testing, broadcast QC
- **Key Sources**: ffmpeg/ffprobe test patterns, QC tools (Vidchecker, Baton), EBU test sequences
- **Quick Checkpoint**: Output file playable, codec correct, duration matches
- **Full Checkpoint**: Frame-accurate diff, audio sync verification, color space compliance, bitrate within spec
- **Key Tools**: `ffprobe`, `ffmpeg -vstats`, `mediainfo`, `melt`, frame-by-frame extraction + SSIM

### check

- **Collection Direction**: Broadcast standards, delivery specs, QC acceptance criteria
- **Key Sources**: ITU-R recommendations, Netflix/YouTube delivery specs, EBU R128 (loudness)
- **Indicators**: Video editing, compositing, VFX, motion
- **Verification Approach**: Frame-accurate comparison, codec validation, timeline continuity checks, render output verification

### exec

- **Collection Direction**: NLE tool operations, effects recipes, render settings, encoding profiles
- **Key Sources**: ffmpeg cookbook, DaVinci Resolve manual, codec encoding guides (x264/x265/AV1)
- **Implementation Approach**: Operate video editing tools (ffmpeg, DaVinci Resolve CLI, melt/MLT, etc.), assemble timelines, apply effects
- **Step Verification**: Frame-accurate comparison, codec validation, timeline continuity, render output verification
