from fastapi import FastAPI
from app.routers import auth, recipes, shopping_list, mom_form

app = FastAPI()

app.include_router(auth.router)
app.include_router(recipes.router)
app.include_router(shopping_list.router)
app.include_router(mom_form.router)

@app.get("/health")
def health():
    return {"status": "ok"}
