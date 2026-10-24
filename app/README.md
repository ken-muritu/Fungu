# Fungu — Flutter app

The v1 client, per `MVP-PRD.md` §5. Talks to `../server` (Next.js API).

## Why there's no `android/` or `ios/` folder here

The platform folders are not committed. `android/` and `ios/` are generated fresh by CI on every build
(`.github/workflows/build-apk.yml`, via `flutter create .` — safe to run
repeatedly, it only adds missing platform folders and never touches
`pubspec.yaml` or `lib/`). If you're developing locally with a real Flutter
install, run this once to generate them locally too:

```
flutter create --platforms=android,ios --org com.fungu --project-name fungu .
```

## Screens (v1)

- `screens/auth/` — login, register (phone + PIN, no email)
- `screens/ledger_screen.dart` — home: everything you're owed or owe, one list
- `screens/create_debt_screen.dart` — two steps: debt details, then the
  non-skippable pre-agreement checklist (+ optional guarantor invite)
- `screens/debt_detail_screen.dart` — status, repayment history, pay via
  STK Push or mark settled manually

## Running locally

Requires a Flutter SDK install.

```
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000
```

`API_BASE_URL` defaults to `http://localhost:3000` if omitted — point it at
`../server` running locally, or a deployed instance.

## Building the release APK

Handled by CI on every push to `app/**` — see the Actions tab for the
`fungu-release-apk` build artifact. To build locally instead:

```
flutter build apk --release --dart-define=API_BASE_URL=https://your-deployment.vercel.app
```

## iOS

No native iOS app yet — that needs a Mac to build on and a paid Apple
Developer account ($99/yr) to get anything onto a real iPhone (TestFlight or
ad-hoc distribution). Neither exists for this project yet. GitHub Actions
has macOS runners that could build an iOS `.ipa` once those credentials
exist — not wired up since there's nothing to sign with.

**What iPhone users get today instead: a web build of the same codebase,
installable as a PWA.** `flutter build web` produces a real installable app
(add-to-home-screen from Safari, full-screen, works without the App Store)
from the exact same Dart source — no Mac needed. Built by
`.github/workflows/build-web.yml` on every push, uploaded as the
`fungu-web-build` artifact.

Deploying it: GitHub Pages needs a paid plan for private repos, so this
project uses Vercel instead (already used for the API backend + Ken's other
sites). No automatic CI deploy is wired up yet (would need a `VERCEL_TOKEN`
secret this repo doesn't have) — for now, deploy manually:

```
gh run download <run-id> -n fungu-web-build -D /tmp/fungu-web
cd /tmp/fungu-web && vercel deploy --prod
```
