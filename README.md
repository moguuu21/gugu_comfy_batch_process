# gugu-uTools for ComfyUI

`gugu-uTools` 提供 ComfyUI 的批量图片/视频加载节点，以及 VNCCS 提示词辅助节点。

## 功能概览

### BatchLoadImages
- 批量加载图片（支持多行列表）。
- `batch` / `single` 两种模式。
- 支持 PNG/JPG/JPEG/WebP/GIF。
- 前端面板支持选择文件、选择文件夹、拖拽上传、逐项入队。

### gugu_BatchLoadVideos
- 基于 PyAV 解码视频并输出帧张量。
- 支持 `skip_frames`、`frame_load_cap`、`select_every_nth`。
- 支持 `video_list` 手动列表和 `server_video_dir` 目录扫描。
- 输出：`IMAGE`（帧）、`FLOAT`（FPS）、`STRING`（文件名列表）。

### VNCCS 提示词节点
- `VNCCS_PositionControl`
- `VNCCS_VisualPositionControl`

## 安装

### 方式 1：ComfyUI Manager
1. 打开 ComfyUI Manager。
2. 搜索并安装本项目。

### 方式 2：手动安装
```bash
cd ComfyUI/custom_nodes
git clone <your-repo-url> mogu_comfy_batch_process
cd mogu_comfy_batch_process
pip install -r requirements.txt
```

## 依赖

- 本项目运行在 ComfyUI 的 Python 环境内。
- 视频节点需要 `av`：

```bash
pip install av
```

`requirements.txt` 已包含：
- `av>=10.0.0,<15.0`

## 节点位置与名称

- 分类：`gugu/utools/IO`
- 节点：
  - `BatchLoadImages`
  - `gugu_BatchLoadVideos`
- 兼容别名：
  - `gugu_BatchLoadImages`
  - `ComfyUI-IAI666-BatchLoadImages`

## BatchLoadImages 参数

- `image_list`：图片路径（每行一个）。
- `max_images`：最大加载数量，`0` 表示不限制。
- `mode`：`batch` / `single`。
- `index`：`single` 模式下的索引。

输出：
- `images`：`[N, H, W, C]`
- `filenames`：换行分隔的文件名字符串。

## gugu_BatchLoadVideos 参数

- `video_list`：视频路径（每行一个）。
- `max_videos`：最大视频数量，`0` 表示不限制。
- `mode`：`batch` / `single`。
- `index`：`single` 模式下的索引。
- `skip_frames`：跳过开头帧数。
- `frame_load_cap`：每个视频最大加载帧数，`0` 表示不限制。
- `select_every_nth`：每 N 帧取 1 帧。
- `server_video_dir`：服务器目录扫描路径。

输出：
- `images`：视频帧张量 `[N, H, W, C]`
- `fps`：平均 FPS（float）
- `filenames`：成功加载的视频名（换行分隔）

## server_video_dir 使用说明

- 可填写相对路径（相对 ComfyUI `input` 目录）或绝对路径。
- 会递归扫描子目录并筛选视频后缀：
  - `.mp4 .webm .avi .mov .mkv .flv .m4v`

示例：
- 相对路径：`my_videos`
- 绝对路径（Windows）：`C:/data/videos`
- 绝对路径（Linux）：`/data/videos`

## 前端面板说明

- 支持 `Select` / `Add` / `Select Folder`。
- 支持拖拽上传到节点面板。
- `Queue All` 会按列表逐项入队；当视频使用 `server_video_dir` 且列表为空时，会回退为批量任务入队。

## 打包与开发

已提供 `pyproject.toml`，可执行：

```bash
pip wheel . --no-deps
```

如需开发工具：

```bash
pip install -e .[dev]
```

## License

MIT
