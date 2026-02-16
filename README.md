# gugu-uTools for ComfyUI

ComfyUI 批量媒体处理工具集，提供工业级的图片和视频批量加载节点�?

## �?功能特�?

### 📷 BatchLoadImages（批量图片加载）
- �?批量上传和管理图�?
- �?支持拖拽上传
- �?可视化预览网�?
- �?Batch/Single 模式切换
- �?支持 GIF 动图多帧加载

### 🎬 BatchLoadVideos（批量视频加载）
- �?基于 PyAV 库的高性能视频解码（参�?VHS 插件�?
- �?支持主流视频格式（MP4, WebM, AVI, MOV, MKV 等）
- �?视频预览（自动循环播放）
- �?精准帧提取和 FPS 信息输出
- �?高级帧控制参数：
  - `skip_frames`: 跳过�?N �?
  - `frame_load_cap`: 限制最大加载帧�?
  - `select_every_nth`: 等间隔抽�?
- �?Batch/Single 模式切换

## 📦 安装

### 方法 1：通过 ComfyUI Manager（推荐）
1. 打开 ComfyUI Manager
2. 搜索 `gugu-uTools`
3. 点击安装

### 方法 2：手动安�?
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/your-repo/gugu-uTools.git mogu_comfy_batch_process
cd mogu_comfy_batch_process
pip install -r requirements.txt
```

### 依赖安装
```bash
# 核心依赖（视频节点必需�?
pip install av

# 如果遇到问题，可以尝试指定版�?
pip install av==10.0.0
```

## 🚀 使用方法

### BatchLoadImages 节点

**位置�?* `gugu/utools/IO` �?`gugu 批量图片加载`

**基本操作�?*
1. 添加节点到工作流
2. 点击"选择图片"按钮上传图片
3. 或直接拖拽图片到预览面板
4. 设置 `mode` �?`batch`（批量）�?`single`（单张）

**参数说明�?*
- `image_list`: 图片路径列表（自动填充）
- `max_images`: 最大加载数量（0 = 无限制）
- `mode`:
  - `batch`: 一次性加载所有图�?
  - `single`: 只加载指定索引的图片
- `index`: 单张模式下的图片索引

**输出�?*
- `images`: 图像张量 [N, H, W, C]
- `filenames`: 文件名列表（换行分隔�?

---

### BatchLoadVideos 节点

**位置�?* `gugu/utools/IO` �?`gugu 批量视频加载 (Batch Videos)`

**基本操作�?*
1. 添加节点到工作流
2. 点击"选择视频"按钮上传视频
3. 或直接拖拽视频到预览面板
4. 视频会自动循环播放预�?
5. 调整帧提取参�?

**参数说明�?*
- `video_list`: 视频路径列表（自动填充）
- `max_videos`: 最大加载视频数�? = 无限制）
- `mode`:
  - `batch`: 一次性加载所有视频的�?
  - `single`: 只加载指定索引的视频
- `index`: 单个模式下的视频索引
- `skip_frames`: 跳过视频开头的 N 帧（用于跳过片头�?
- `frame_load_cap`: 最大加载帧数（0 = 无限制，用于控制内存�?
- `select_every_nth`: �?N 帧选一帧（1 = 全选，2 = 隔帧，用于降低帧率）
- `server_video_dir`: **[可选]** 服务器视频目录路径（用于远程服务器场景）

**输出�?*
- `images`: 视频帧张�?[N, H, W, C]
- `fps`: 原始视频 FPS（浮点数�?
- `filenames`: 文件名列表（换行分隔�?

**使用示例�?*

```
示例 1：加载完整视�?
- skip_frames: 0
- frame_load_cap: 0
- select_every_nth: 1
�?加载所有帧

示例 2：跳过片头，只加载前 100 �?
- skip_frames: 30
- frame_load_cap: 100
- select_every_nth: 1
�?跳过�?30 帧，然后加载 100 �?

示例 3：降低帧率（30fps �?15fps�?
- skip_frames: 0
- frame_load_cap: 0
- select_every_nth: 2
�?每隔一帧选一�?

示例 4：提取关键帧（每�?1 帧，假设原视�?30fps�?
- skip_frames: 0
- frame_load_cap: 0
- select_every_nth: 30
�?�?30 帧选一�?
```

---

### 🌐 远程服务器使�?

**问题**：当 ComfyUI 运行在远程服务器上时，点�?选择视频"按钮会打开本地文件浏览器，无法访问服务器上的文件�?

**解决方案**：使�?`server_video_dir` 参数直接指定服务器上的视频目录�?

#### 方法 1：使用相对路径（推荐�?

将视频文件放�?ComfyUI �?`input` 目录下，然后使用相对路径�?

```
示例�?
- 视频位置：ComfyUI/input/my_videos/video1.mp4
- server_video_dir 参数填写：my_videos

节点会自动扫�?input/my_videos/ 目录下的所有视频文�?
```

#### 方法 2：使用绝对路�?

直接指定服务器上的完整路径：

```
示例�?
- server_video_dir 参数填写�?home/user/videos
- �?Windows: C:/Users/user/videos

节点会自动扫描该目录下的所有视频文�?
```

#### 方法 3：手动输入路径列�?

�?`video_list` 文本框中手动输入视频路径（每行一个）�?

```
示例�?
my_videos/video1.mp4
my_videos/video2.mp4
subfolder/video3.mp4
```

**注意**�?
- `server_video_dir` 会递归扫描子目�?
- 扫描到的文件会自动添加到 `video_list` �?
- 支持的格式：.mp4, .webm, .avi, .mov, .mkv, .flv, .m4v

```

## 🎯 高级功能

### 逐张/逐个入队
- **逐张入队**（图片）/ **逐个入队**（视频）：自动将每张图片/每个视频作为独立任务加入队列
- **入队当前**：将当前选中的单个媒体加入队�?

### 文件夹批量上�?
- 点击"选择文件�?按钮
- 自动递归扫描文件夹中的所有媒体文�?
- 按文件名排序

### 拖拽上传
- 支持拖拽文件到预览面�?
- 支持拖拽文件到节点上
- 自动过滤文件类型

## ⚙️ 技术细�?

### 视频解码引擎
- 使用 **PyAV** 库（FFmpeg �?Python 绑定�?
- 参�?**ComfyUI-VideoHelperSuite** 的实�?
- 支持硬件加速解码（取决�?FFmpeg 编译选项�?
- 自动处理视频旋转元数�?

### 支持的视频格�?
- MP4 (H.264, H.265)
- WebM (VP8, VP9)
- AVI
- MOV (QuickTime)
- MKV (Matroska)
- FLV
- M4V

### 支持的图片格�?
- PNG
- JPEG/JPG
- WebP
- GIF（支持动图多帧）

## ⚠️ 注意事项

1. **内存管理**
   - 加载大量高分辨率视频帧会占用大量内存
   - 建议使用 `frame_load_cap` 限制帧数
   - 使用 `select_every_nth` 降低帧率

2. **视频解码性能**
   - 首次解码视频可能较慢（取决于视频编码格式�?
   - 建议使用 H.264 编码�?MP4 文件以获得最佳性能
   - 4K 视频解码会消耗更�?CPU/GPU 资源

3. **依赖检�?*
   - 如果 `av` 库未安装，视频节点会显示错误提示
   - 确保 FFmpeg 已正确安装在系统�?

4. **文件路径**
   - 所有文件会自动上传�?ComfyUI �?`input` 目录
   - 支持 ComfyUI 的路径注解系�?

## 🔧 故障排除

### 问题：视频节点显�?"av 库未安装"
**解决方案�?*
```bash
pip install av
# 或指定版�?
pip install av==10.0.0
```

### 问题：视频加载失�?
**可能原因�?*
- 视频编码格式不支�?
- 视频文件损坏
- FFmpeg 未正确安�?

**解决方案�?*
```bash
# 检�?FFmpeg 是否安装
ffmpeg -version

# 尝试转换视频格式
ffmpeg -i input.mov -c:v libx264 -preset fast output.mp4
```

### 问题：内存不�?
**解决方案�?*
- 减少 `frame_load_cap` 参数
- 增加 `select_every_nth` 参数
- 分批处理视频

## 📊 性能参�?

| 视频规格 | 帧数 | 内存占用（约�?| 加载时间（约�?|
|---------|------|--------------|--------------|
| 1080p 30fps 10s | 300 | ~2GB | 5-10s |
| 1080p 30fps 10s (�?帧�?) | 150 | ~1GB | 3-5s |
| 4K 60fps 10s | 600 | ~8GB | 15-30s |
| 4K 60fps 10s (�?帧�?) | 150 | ~2GB | 8-15s |

*测试环境：Intel i7-12700K, 32GB RAM, RTX 3080*

## 🤝 贡献

欢迎提交 Issue �?Pull Request�?

## 📄 许可�?

MIT License

## 🙏 致谢

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) - 强大�?Stable Diffusion GUI
- [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) - 视频解码逻辑参�?
- [PyAV](https://github.com/PyAV-Org/PyAV) - FFmpeg Python 绑定

---

**开发者：** gugu
**版本�?* 1.0.0
**最后更新：** 2026-01-28


