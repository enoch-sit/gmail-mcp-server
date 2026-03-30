**Yes**, Docker Desktop **can access your GPU** (NVIDIA CUDA) **and run vLLM**, but it depends on your host OS and setup. Here's the current (2026) situation broken down clearly:

### 1. Docker Desktop GPU Access
| Platform       | NVIDIA GPU (CUDA) Support? | How it works                                                                 | Notes / Requirements |
|----------------|----------------------------|------------------------------------------------------------------------------|----------------------|
| **Windows**    | Yes (official & mature)   | WSL 2 backend + NVIDIA GPU Paravirtualization (GPU-PV)                     | Windows 10/11 + latest NVIDIA drivers (CUDA on WSL2), Docker Desktop 4.29+ |
| **macOS**      | No (CUDA)                 | No native NVIDIA/CUDA support                                                | Apple Silicon only: limited Metal support via Docker Model Runner (vllm-metal backend) |
| **Linux**      | No                        | Docker Desktop runs in a VM without direct GPU passthrough                   | Use native **Docker Engine** + NVIDIA Container Toolkit instead |

Official Docker docs confirm GPU support is **Windows-only** for Docker Desktop (via WSL 2).

### 2. Running vLLM in Docker Desktop
**Yes — it works great** when GPU access is available.

- **Official vLLM Docker image**: `vllm/vllm-openai` (on Docker Hub)  
  Run it with:  
  ```bash
  docker run --gpus all \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    -p 8000:8000 \
    vllm/vllm-openai:latest \
    --model meta-llama/Llama-3.1-8B-Instruct
  ```
  (The `--gpus all` flag works automatically on Windows with Docker Desktop.)

- **Even easier on Windows**: Docker now has **Docker Model Runner** with native **vLLM backend** (added late 2025).  
  Just do:
  ```bash
  docker model install-runner --backend vllm --gpu cuda
  docker model run <your-model>
  ```
  This gives high-throughput vLLM inference directly in Docker Desktop on Windows + NVIDIA GPU.

### Quick Start Checklist (Windows – most common case)
1. Update Docker Desktop (≥ 4.54 recommended for full vLLM Model Runner support).
2. Make sure WSL 2 is enabled and your NVIDIA drivers are the latest WSL2/CUDA ones.
3. Pull the image and run with `--gpus all` (or use Model Runner).

On **macOS** you can still run vLLM via the `vllm-metal` backend in Docker Model Runner if you have Apple Silicon, but it’s **not** the full CUDA vLLM experience.

**Bottom line**:  
- **Windows + NVIDIA** → Yes, full GPU + vLLM works perfectly.  
- **macOS/Linux** → Use native Docker Engine (Linux) or Metal backend (macOS) for best results.

If you tell me your OS (Windows/macOS/Linux) and GPU type, I can give you the exact commands!