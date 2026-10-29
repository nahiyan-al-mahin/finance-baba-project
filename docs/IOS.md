# Finance Baba on iPhone and iPad

There are two ways to get it on iPhone. Start with option 1: it works today, costs nothing and needs no review.

## Option 1 — Install from Safari (free, works now)

Finance Baba is an installable web app. Tell iPhone users:

1. Open **https://financebaba.vercel.app** in **Safari**.
2. Tap the **Share** button (the square with an arrow), then **Add to Home Screen**, then **Add**.

The app gets its own icon and opens full-screen with the same account and data. The website shows this hint
to iPhone visitors in the "Get the app" box. It is not listed in the App Store, though.

## Option 2 — Publish in the Apple App Store

Apple has no equivalent of Android's Trusted Web Activity, so the iOS app has to be a small native app (built
with Capacitor) that shows the website inside it. Before you start, know these points:

| Need | Details |
| --- | --- |
| Apple Developer Program | **US$99 per year**: <https://developer.apple.com/programs/> (personal account; D-U-N-S number only for companies) |
| A Mac with Xcode | Needed to build and upload. Alternatives: a cloud Mac (MacinCloud, about US$1/hour) or GitHub Actions macOS runners with an App Store Connect API key. |
| Apple's review rules | **Guideline 4.2 (minimum functionality):** Apple often rejects apps that are "just a website". Add something native, such as Face ID lock, home-screen widgets or native notifications, to pass. |
| | **Guideline 4.8 (login services):** if the iOS app offers *Sign in with Google*, it must also offer *Sign in with Apple*. Easiest fix: hide the Google button inside the iOS app; username/password login is allowed. |
| | **Google sign-in inside an app web view is blocked by Google**, which is another reason to hide it on iOS. |
| | **Account deletion** must be possible inside the app. It already is: Settings → Danger zone. |
| | **Privacy policy:** https://financebaba.vercel.app/privacy |

### Steps

1. Join the Apple Developer Program and wait for approval (usually 1–2 days).
2. On a Mac, install **Xcode** from the Mac App Store.
3. Create the iOS wrapper. Ask Claude to add a Capacitor `ios/` project that:
   - loads `https://financebaba.vercel.app/app`;
   - hides Google sign-in inside the app;
   - adds a Face ID / passcode lock, which gives Apple its native feature.
4. Open the `ios/` project in Xcode. Under **Signing & Capabilities**, choose your team. Use the bundle ID
   `com.financebaba.app`.
5. In **App Store Connect** (<https://appstoreconnect.apple.com>), go to **My Apps → + → New App**. Fill in the name,
   bundle ID, SKU, privacy policy URL and the **App Privacy** answers:
   - data collected: name, email, financial info;
   - linked to the user;
   - not used for tracking.
6. In Xcode, choose **Product → Archive → Distribute App → App Store Connect → Upload**.
7. Test with **TestFlight** (up to 10,000 testers by link). Then add screenshots for 6.9" and 6.5" iPhones,
   a description, keywords, a support URL and a demo login for the reviewer. Choose **Submit for Review**.
8. Review usually takes 1–3 days. If Apple cites guideline 4.2, add more native features and resubmit.
