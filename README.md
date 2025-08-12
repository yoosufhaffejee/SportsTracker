# Sports Tracker (Static Web App)

A lightweight, static HTML/CSS/JS app for managing players, friendly matches, and community tournaments. Designed for GitHub Pages hosting, using Google Sign-In and Firebase Realtime Database via REST (fetch).

## Features
- Google Sign-In using GIS
- Players CRUD and skill progression
- Radar chart via Chart.js
- Modular JS (type=module)
- Dark mode

## Setup
1. Replace Google Client ID in `js/auth.js` (APP_GIS_CLIENT_ID or inline placeholder).
2. Replace `databaseURL` in `js/firebase.js` with your RTDB URL.
3. (Optional) Configure Realtime Database Rules to restrict access.

## Local preview
Open `index.html` with a local server (GitHub Pages requires HTTPS for GIS on deploy).

## Deploy to GitHub Pages
- Commit and push to a GitHub repo.
- Enable Pages in repo settings (branch: `main`, folder: `/root`).

## Notes
- For simplicity we use GIS ID token and REST calls; consider Firebase Auth SDK for stricter security and server-side verification.
- `config.json` defines sports and core rating attributes.
