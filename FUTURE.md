# Future Roadmap

This document outlines planned features and improvements for Issei. THe current v1 is a backend API with core recipe management, scaling, and shopping list features. The roadmap below represents the natural evolution toward a full product.

---

## Multi-User Family Sharing

**Current state:** The schema is designed with `user_id` on every entity and a `families` table sketched but not implemented. Only single-user access exists in v1.

**What this adds:** Multiple family members share a recipe library. Mom adds recipes, children and grandchildren access them. Invitations sent via email or shareable link. Role-based access (owner can edit, members can read).

**Why it matters:** The core use case — preserving family cooking across generations — requires multiple people to access the same library. A recipe added by mom should be visible to her children without manual sharing.

**Implementation notes:** Add `families` and `family_members` tables. Update authorization checks from `user_id == current_user.id` to `family_id in current_user.families`. Add invitation endpoints with token-based acceptance.

---

## Web Frontend

**Current state:** v1 is a backend API only. Testing is done via the auto-generated /docs page.

**What this adds:** A full web interface for inputting, browsing, scaling, and sharing recipes from any device. Designed for non-technical users — specifically the parents and grandparents who are the primary recipe contributors.

**Why it matters:** The core users (immigrant parents) won't use an API docs page. A simple, mobile-responsive web UI is what makes the product actually usable for its intended audience.

**Implementation notes:** React frontend, deployed alongside the existing FastAPI backend on Render. Mobile-responsive from day one since most users will access from phones.

---

## iOS Mobile App

**Current state:** No mobile app exists. The web frontend (planned above) will be mobile-responsive as an interim solution.

**What this adds:** A native iOS experience with faster performance, push notifications for family recipe updates, and camera access for photographing handwritten recipes or dishes.

**Why it matters:** The use case is fundamentally mobile — someone cooking in a kitchen checks a recipe on their phone, not a laptop. Native mobile also enables features impossible in a web app, like voice input for hands-free recipe lookup while cooking.

**Implementation notes:** React Native for cross-platform coverage (iOS and Android), TestFlight for beta testing with initial users, App Store launch after beta validation.

---

## Translation

**What this adds:**

**Why it matters:**

**Implementation notes:**

---

## Voice Input

**What this adds:**

**Why it matters:**

**Implementation notes:**

---

## Recipe Versioning

**What this adds:**

**Why it matters:**

**Implementation notes:**

---

## Photo/Video Support

**What this adds:**

**Why it matters:**

**Implementation notes:**

---

## Ingredient Canonicalization

**What this adds:**

**Why it matters:**

**Implementation notes:**

---

## What I'd Build First


