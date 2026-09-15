# Stronger

## Purpose

A personal fitness app for planning and executing strength-training workouts. It provides a phone-friendly UI with Cloud Firestore as the single source of truth for application data.

## Vision

Load up the GitHub Pages site on your phone, pick today's planned workout, and go. Workout protocols become structured plans stored in Firestore. The app reads those plans and provides a clean interface to work through sets, reps, and weights in the gym.

## Principles

- **Firestore is the database**: Application data lives under each user's Firebase UID. Local caching and queued writes keep previously loaded data and workout logging usable offline.
- **Static frontend deployment**: The app is a static site on GitHub Pages backed by managed Firebase services, with no custom application server.
- **User-scoped access**: Firebase Authentication handles sign-in, and Firestore rules isolate each user's data. Separate Google OAuth authorization is optional and used only for Calendar synchronization.
- **Prompt-driven programming**: Workout protocols (e.g., 5/3/1, linear progression) are defined as reusable prompts that generate portable workout definitions. Adding a new program means writing a new prompt, not new app code.
- **Phone-first UI**: The primary use case is standing in a gym holding a phone. The interface must be thumb-friendly and readable at arm's length.

## Tech Stack

- **Frontend**: TypeScript + React
- **Build**: Bundled for production deploy to GitHub Pages; live-transpiled during development
- **Data**: Cloud Firestore, protected by Firebase Authentication
- **Hosting**: GitHub Pages (static)

## Scope

### What this project is

- A workout tracker that reads planned workouts from Firestore
- A phone-friendly UI for executing a workout (sets, reps, weights, rest timers)
- A prompt-based system for generating workout plans

### What this project is not

- A social or sharing platform
- A nutrition or diet tracker
- An exercise library with video demos
- A collaborative training or coaching platform

## Target Users

Just me. This is a personal tool built to my preferences. If it's useful to others, great, but that's not a design constraint.
