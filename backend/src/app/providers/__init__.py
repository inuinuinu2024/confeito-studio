# providers package

from .gemini import GeminiProvider

class ProviderFactory:
    def __init__(self):
        self.providers = {
            "gemini": GeminiProvider(),
        }

    def get_provider(self, name: str):
        return self.providers.get(name)

provider_factory = ProviderFactory()
