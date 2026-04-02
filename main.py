"""Video Skills Platform 入口

启动 FastAPI 后端服务
"""

import uvicorn


def main():
    """CLI 入口"""
    print("Starting Video Skills Platform...")
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    main()
