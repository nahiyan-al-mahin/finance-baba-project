# Finance Baba on Android and the Google Play Store

The Android app lives in `android/`. It is a **Trusted Web Activity**: the installed app opens your live
website full-screen using Chrome, with no address bar. So it uses **the same website, the same Neon database and the
same accounts**. Anything you deploy to Vercel shows up in the app right away. You don't need to publish an app update.

Google sign-in, PDF downloads, notifications and Bangla all work the same as in Chrome.

There are two ways people can get the app:

| Way | Who it's for | Cost |
| --- | --- | --- |
| **Install from the website** (the "Install app" button, or Chrome menu → *Add to Home screen*) | Anyone, today | Free |
| **Google Play Store** | Everyone who searches the Play Store | US$25 once (developer account) |

---

## 1. Check the website address

Open `android/app/build.gradle` and look at the `hostName` line at the top:

```groovy
hostName: 'financebaba.vercel.app', // your website, without https://
```

It must be the exact address people use to open the site, without `https://`. If you add your own domain
later, change it here and build again.

## 2. Build the app (GitHub does it for you)

Every push that changes `android/` builds the app automatically. You can also start a build by hand:
GitHub → your repository → **Actions** → **Android app** → **Run workflow**.

When the run turns green, open it and scroll to **Artifacts**:

- **finance-baba-apk**: unzip it and copy the `.apk` to an Android phone to install and try it.
  The phone will ask to allow "install unknown apps" the first time.
- **finance-baba-aab**: the file you upload to the Play Store.

### Signing (needed for the Play Store)

The Play Store only accepts apps signed with *your* upload key. You were given two files privately:
`finance-baba-upload.jks` and `GITHUB-SECRETS.txt`. **Keep both safe and never put them in the repository.**

1. GitHub → your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add the four secrets exactly as written in `GITHUB-SECRETS.txt`:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. Run the **Android app** workflow again. The run summary will say *"Signed with your upload key"*.

Without these secrets the build is signed with a test key. That build installs on a phone, but Play rejects it.

## 3. Create a Google Play developer account

1. Go to <https://play.google.com/console> and sign in with the Google account that should own the app.
2. Choose **Yourself** (personal account), pay the one-time **US$25** fee, and complete identity verification.
   Google asks for an ID and may take a few days.
3. Verify a phone number and the contact email.

> **New personal accounts must run a closed test first.** At least **12 testers** must have the app installed
> for **14 days in a row** before you can apply for production. Plan for this. Ask friends and family to join
> (step 5).

## 4. Create the app in Play Console

1. **Create app** → App name **Finance Baba**, default language (English or Bangla), **App**, **Free**. Accept the declarations.
2. **Dashboard → Set up your app**. Complete every item:
   - **Privacy policy**: use `https://financebaba.vercel.app/privacy`. The page is already part of the website.
   - **App access**: choose *All or some functionality is restricted* and give the reviewer a test login
     (create a demo user with a few entries).
   - **Ads**: *No*.
   - **Content rating**: fill in the questionnaire. Category: *Utility, Productivity, Communication or Other*.
   - **Target audience**: 18+.
   - **Data safety**:
     - *Collects data: Yes.* Personal info: name and email address. Financial info: purchase history / other financial info.
     - *Encrypted in transit: Yes.*
     - *Users can request deletion: Yes* (Settings → Delete account).
     - *Shared with third parties: No.*
   - **Financial features**: choose *My app doesn't provide any financial features* from the list of regulated
     services, or *Other* and describe it as a personal expense tracker. It does not move money or give loans.
   - **Government app**: No.
3. **Store listing** (Grow → Store presence → Main store listing):
   - Short description (80 characters), for example: *Track daily spending, loans & savings in Bangla or English.*
   - Full description: explain the features (daily log, reports, PDF, targets, loans, savings, currencies, encryption).
   - **App icon**: `store-assets/play-icon-512.png`
   - **Feature graphic**: `store-assets/feature-graphic-1024x500.png`
   - **Phone screenshots**: at least 2. Take them on your phone from inside the app.

## 5. Upload the app and test it

1. **Test and release → Testing → Closed testing** → create a track → **Create new release**.
2. When asked about app signing, keep **Use Google-generated key (Play App Signing)**. This is recommended.
3. Upload the `.aab` from the **finance-baba-aab** artifact. Add release notes, then **Save → Review → Start rollout**.
4. Add testers by email (a Google Group or an email list) and share the opt-in link with them.

## 6. Connect the app to the website (removes the address bar)

The app opens full-screen only after the website confirms the app is really yours. Do this once:

1. Play Console → your app → **Test and release → Setup → App signing** (sometimes shown as **App integrity**).
2. Copy the **SHA-256 certificate fingerprint** under **App signing key certificate**.
3. Vercel → your project → **Settings → Environment Variables** → add:
   - `ANDROID_CERT_SHA256` = that fingerprint. To also trust APKs you build yourself, add the upload key's
     fingerprint after a comma.
4. **Redeploy** on Vercel. Then open `https://financebaba.vercel.app/.well-known/assetlinks.json`. It should show
   `com.financebaba.app` and your fingerprint.

If you skip this, the app still works, but it shows a small address bar at the top.

## 7. Go live

After 14 days with 12 or more testers: **Dashboard → Apply for production**, then answer the questions about your
test. Once approved, go to **Production → Create new release**, add the same (or a newer) `.aab`, and roll out.
Review usually takes from a few hours to a few days.

## Updating the app later

- **Website changes** (almost everything): just deploy to Vercel. The app shows them immediately.
- **App changes** (icon, name, web address): edit `android/`, push, and download the new `.aab`. Upload it as a
  new release. Each GitHub run number becomes the version code automatically, so it always goes up.

## Building on your own computer (optional)

Open the `android/` folder in **Android Studio**. To sign, create `android/keystore.properties`; it is never
committed:

```properties
storeFile=/full/path/to/finance-baba-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

Then choose **Build → Generate Signed App Bundle / APK**, or run `./gradlew bundleRelease`.

## iPhone

Apple doesn't allow this kind of app in the App Store. iPhone users can install it from Safari: **Share → Add to Home Screen**.
It opens full-screen with the same account. The website explains this in the "Get the app" box.
