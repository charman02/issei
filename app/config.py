from pydantic_settings import BaseSettings
from pydantic import ConfigDict

class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()
