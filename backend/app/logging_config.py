"""Loguru 日志配置

替换标准库 logging，统一格式，并拦截第三方库（uvicorn、langchain 等）的日志。
"""

from __future__ import annotations

import logging
import sys

from loguru import logger


class _InterceptHandler(logging.Handler):
    """将标准库 logging 的输出转发到 loguru。"""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back  # type: ignore[assignment]
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def setup_logging(level: str = "INFO") -> None:
    """初始化 loguru，拦截标准库日志。在 lifespan 最开始调用。"""
    logger.remove()
    logger.add(
        sys.stdout,
        level=level,
        format=(
            "<green>{time:HH:mm:ss.SSS}</green> "
            "| <level>{level: <7}</level> "
            "| <cyan>{name}</cyan>:<cyan>{line}</cyan> "
            "— {message}"
        ),
        colorize=True,
    )

    # 拦截标准库 logging（uvicorn、langchain、langgraph 等）
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
        logging.getLogger(name).handlers = [_InterceptHandler()]
        logging.getLogger(name).propagate = False
