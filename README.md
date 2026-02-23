# gugu-uTools for ComfyUI

Maintainable ComfyUI custom nodes focused on batch media loading and VNCCS prompt helpers.

## Nodes

1. `BatchLoadImages`
- Load image files from a multiline list.
- Supports `batch` and `single` mode.
- Outputs: `IMAGE`, `STRING(filenames)`.

2. `gugu_BatchLoadVideos`
- Decode video frames via PyAV.
- Supports `skip_frames`, `frame_load_cap`, `select_every_nth`.
- Supports manual `video_list` and recursive `server_video_dir` scan.
- Outputs: `IMAGE`, `FLOAT(fps)`, `STRING(filenames)`.

3. `VNCCS_PositionControl`
- Build a camera-position prompt from azimuth/elevation/distance.

4. `VNCCS_VisualPositionControl`
- Build a prompt from hidden JSON field `camera_data`.

## Project Layout

```text
mogu_comfy_batch_process/
|- __init__.py                     # ComfyUI node export entry
|- core/
|  |- list_utils.py                # List parsing, limit, single index selection
|  |- media_paths.py               # Path resolve, scan entry model, preview params
|  |- hash_utils.py                # Shared hash helpers for IS_CHANGED
|- services/
|  |- image_service.py             # Image decode to Tensor
|  |- media_scan_service.py        # Scan payload assembly for API route
|  |- preview_proxy_service.py     # Secure preview token registry + file resolve
|  |- video_service.py             # Video decode to frame tensors
|  |- vnccs_service.py             # VNCCS prompt generation
|- nodes/
|  |- batch_load_images.py         # Image node class
|  |- batch_load_videos.py         # Video node class
|  |- vnccs.py                     # VNCCS node classes
|  |- registry.py                  # NODE_CLASS_MAPPINGS / DISPLAY mappings
|- web/
|  |- batch_load_images.js         # Frontend entrypoint
|  |- modules/
|     |- common.js                 # Shared frontend utils
|     |- media_extension.js        # Media browser extension
|     |- media_preview.js          # Input preview/url helpers for images/videos
|     |- vnccs_extension.js        # VNCCS visual extension
```

## Why This Split

- Keep node files thin: only ComfyUI I/O contract and orchestration.
- Move reusable logic into `core/` and `services/`.
- Keep frontend extension code modular and easier to iterate.

## Install

```bash
cd ComfyUI/custom_nodes
git clone <your-repo-url> mogu_comfy_batch_process
cd mogu_comfy_batch_process
pip install -r requirements.txt
```

Video node extra dependency:

```bash
pip install av
```

## Development Notes

1. Add new nodes in `nodes/`.
2. Move shared logic to `services/` or `core/`.
3. Keep node name aliases when changing APIs to avoid workflow breaks.
4. Run syntax checks before commit:

```bash
python -m compileall .
```

## License

MIT
