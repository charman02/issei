from pydantic_settings import BaseSettings
from pydantic import ConfigDict


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    # Comma-separated allowed frontend origins for CORS. Set in the deploy env
    # (e.g. the Vercel URL) so adding a frontend host needs no code change.
    # Local dev and the existing Render backend are always allowed.
    cors_origins: str = ""

    model_config = ConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        defaults = [
            "http://localhost:5173",
            "https://family-recipe-library.onrender.com",
        ]
        extra = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        seen, out = set(), []
        for o in defaults + extra:
            if o not in seen:
                seen.add(o)
                out.append(o)
        return out


settings = Settings()
