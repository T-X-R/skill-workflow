"""System Tools — 通用工具，供 Orchestrator Agent 使用

包括：
- run_bash       — 执行 shell 命令（ffmpeg、ffprobe 等）
- read_file      — 读取文件内容
- write_file     — 写入文件内容
- download_file  — 从 URL 下载文件到本地
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.request
from pathlib import Path

from langchain.tools import tool, ToolRuntime
from loguru import logger

from .skill_tools import SessionContext

BASH_TIMEOUT = 120  # 秒
MAX_OUTPUT_CHARS = 8000


@tool
async def run_bash(command: str, runtime: ToolRuntime[SessionContext]) -> str:
    """Execute a shell command and return stdout/stderr.

    Use for ffmpeg, ffprobe, and other command-line operations that are not
    covered by existing skill scripts. Prefer skill scripts when available.

    Args:
        command: The shell command to execute
    """
    logger.info(f"[bash] $ {command[:150]}")
    t0 = time.monotonic()

    try:
        process = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=BASH_TIMEOUT,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            logger.warning(f"[bash] TIMEOUT after {BASH_TIMEOUT}s — {command[:80]}")
            return json.dumps({
                "success": False,
                "error": f"命令超时（>{BASH_TIMEOUT}s）",
                "command": command,
            })

        stdout_text = stdout.decode("utf-8", errors="replace").strip()
        stderr_text = stderr.decode("utf-8", errors="replace").strip()
        success = process.returncode == 0
        elapsed = time.monotonic() - t0

        if success:
            logger.info(f"[bash] rc=0 ({elapsed:.1f}s)")
        else:
            hint = stderr_text[:120].replace("\n", " ") if stderr_text else "(no stderr)"
            logger.warning(f"[bash] rc={process.returncode} ({elapsed:.1f}s) — {hint}")

        result: dict = {
            "success": success,
            "returncode": process.returncode,
        }
        if stdout_text:
            result["stdout"] = stdout_text[:MAX_OUTPUT_CHARS]
        if stderr_text:
            result["stderr"] = stderr_text[:MAX_OUTPUT_CHARS]

        return json.dumps(result, ensure_ascii=False)

    except Exception as e:
        logger.error(f"[bash] ERROR: {e}")
        return json.dumps({"success": False, "error": str(e)})


@tool
def read_file(file_path: str, runtime: ToolRuntime[SessionContext]) -> str:
    """Read the contents of a local file.

    Useful for reading SRT subtitle files, JSON outputs, log files, etc.

    Args:
        file_path: Absolute path to the file to read
    """
    path = Path(file_path)

    if not path.exists():
        logger.warning(f"[read_file] NOT FOUND: {file_path}")
        return json.dumps({"success": False, "error": f"文件不存在: {file_path}"})

    if not path.is_file():
        logger.warning(f"[read_file] NOT A FILE: {file_path}")
        return json.dumps({"success": False, "error": f"路径不是文件: {file_path}"})

    try:
        size = path.stat().st_size
        if size > 5 * 1024 * 1024:  # 5MB limit
            logger.warning(f"[read_file] TOO LARGE ({size // 1024} KB): {file_path}")
            return json.dumps({
                "success": False,
                "error": f"文件过大（{size // 1024}KB），请使用 run_bash 分段读取"
            })

        content = path.read_text(encoding="utf-8", errors="replace")
        truncated = len(content) > MAX_OUTPUT_CHARS
        if truncated:
            content = content[:MAX_OUTPUT_CHARS] + f"\n...[内容已截断，共 {len(content)} 字符]"

        logger.info(f"[read_file] {path.name}  {size // 1024} KB{' (truncated)' if truncated else ''}")
        return json.dumps({"success": True, "content": content, "size": size}, ensure_ascii=False)

    except Exception as e:
        logger.error(f"[read_file] ERROR {file_path}: {e}")
        return json.dumps({"success": False, "error": str(e)})


@tool
def write_file(file_path: str, content: str, runtime: ToolRuntime[SessionContext]) -> str:
    """Write content to a local file.

    Use for creating SRT subtitle files, configuration files, etc.

    Args:
        file_path: Absolute path to write to (parent dirs created automatically)
        content: Content to write
    """
    path = Path(file_path)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        logger.info(f"[write_file] {path.name}  {len(content)} chars")
        return json.dumps({
            "success": True,
            "file_path": str(path),
            "size": len(content),
        })
    except Exception as e:
        logger.error(f"[write_file] ERROR {file_path}: {e}")
        return json.dumps({"success": False, "error": str(e)})


@tool
async def download_file(
    url: str,
    save_path: str,
    runtime: ToolRuntime[SessionContext],
) -> str:
    """Download a file from a URL to a local path.

    Args:
        url: The URL to download from
        save_path: Local absolute path to save the file
    """
    path = Path(save_path)
    logger.info(f"[download] {url[:80]} → {path.name}")

    try:
        path.parent.mkdir(parents=True, exist_ok=True)

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _download_sync, url, path)

        size = path.stat().st_size
        logger.info(f"[download] OK  {path.name}  {size // 1024} KB")
        return json.dumps({
            "success": True,
            "file_path": str(path),
            "size": size,
            "url": url,
        })
    except Exception as e:
        logger.error(f"[download] ERROR {url[:80]}: {e}")
        return json.dumps({"success": False, "error": str(e), "url": url})


def _download_sync(url: str, path: Path) -> None:
    urllib.request.urlretrieve(url, str(path))


# ── Builder ──────────────────────────────────────────────────────────

def build_system_tools() -> list:
    return [run_bash, read_file, write_file, download_file]
