from fastapi import FastAPI
from app.routers import auth, recipes

app = FastAPI()

app.include_router(auth.router)
app.include_router(recipes.router)


@app.get("/health")
def health():
    return {"status": "ok"}
