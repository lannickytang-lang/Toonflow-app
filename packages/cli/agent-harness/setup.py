#!/usr/bin/env python3
"""cli-tdd-toonflow —— Toonflow headless 画布生产 CLI（命令 tdd）。

安装：python -m pip install -e .（此后全局命令 tdd 可用）。
依赖：Python 3.10+、click>=8；后端为本机 Toonflow server（默认 http://127.0.0.1:3000）。
"""

from setuptools import find_namespace_packages, setup

setup(
    name="cli-tdd-toonflow",
    version="1.8.1",
    description="Toonflow CLI — headless 画布生产：导入分镜、批量生成、挂机监控、失败排查与断点重建（转发本机 Toonflow server）",
    packages=find_namespace_packages(include=["cli_tdd.*"]),
    python_requires=">=3.10",
    install_requires=["click>=8.0.0"],
    entry_points={"console_scripts": ["tdd=cli_tdd.toonflow.toonflow_cli:main"]},
    package_data={"cli_tdd.toonflow": ["skills/*.md"]},
)
