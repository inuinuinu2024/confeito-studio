"""Base class for image generation providers (Provider Pattern)."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class GenerationResult:
    """画像生成の結果を格納するデータクラス。"""

    image_bytes: bytes
    """生成された画像のバイト列 (PNG)"""

    width: int
    height: int

    metadata: dict | None = None
    """プロバイダー固有のメタデータ（シード値、モデル名等）"""


class ImageGenerationProvider(ABC):
    """
    生成AIプロバイダーの抽象基底クラス。

    ComfyUI, Stability AI, Google Imagen 等を差し替え可能にするための
    共通インターフェースを定義する。

    Usage:
        class ComfyUIProvider(ImageGenerationProvider):
            async def generate(self, prompt, negative_prompt, **params):
                ...

        class StabilityAIProvider(ImageGenerationProvider):
            async def generate(self, prompt, negative_prompt, **params):
                ...
    """

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        *,
        width: int = 512,
        height: int = 512,
        **params: object,
    ) -> GenerationResult:
        """
        画像を生成する。

        Args:
            prompt: ポジティブプロンプト
            negative_prompt: ネガティブプロンプト
            width: 出力画像の幅
            height: 出力画像の高さ
            **params: プロバイダー固有のパラメータ
                      (denoising_strength, cfg_scale, seed 等)

        Returns:
            GenerationResult: 生成結果
        """
        ...

    @abstractmethod
    async def get_status(self) -> dict:
        """
        プロバイダーの接続状態を返す。

        Returns:
            {"connected": bool, "provider": str, ...}
        """
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """プロバイダー名 (例: "ComfyUI", "Stability AI")"""
        ...
