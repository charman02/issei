from fastapi import FastAPI
from app.routers import auth, recipes, shopping_list

app = FastAPI()

app.include_router(auth.router)
app.include_router(recipes.router)
app.include_router(shopping_list.router)

@app.get("/health")
def health():
    return {"status": "ok"}
