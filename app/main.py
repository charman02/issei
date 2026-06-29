from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, recipes, shopping_list, mom_form, upload

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://family-recipe-library.onrender.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(recipes.router)
app.include_router(shopping_list.router)
app.include_router(mom_form.router)
app.include_router(upload.router)

@app.get("/health")
def health():
    return {"status": "ok"}
