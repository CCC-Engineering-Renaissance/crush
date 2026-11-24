// Member portal settings. Fill these in once, after creating the Firebase project (SETUP.md, step 2).
//
// None of these values are secrets. Every Firebase web app ships its config to the browser;
// the data stays protected by the Firestore security rules (firebase/firestore.rules) and by
// restricting the API keys to engineeringrenaissance.org in Google Cloud.
//
// While firebase.apiKey is blank, the portal shows a setup notice and a demo with sample data.

export default {
  firebase: {
    apiKey: '',
    authDomain: '',        // e.g. 'er-portal.firebaseapp.com'
    projectId: '',         // e.g. 'er-portal'
    appId: '',
    messagingSenderId: '',
  },

  // Google Drive file picker and "Export to Google Sheets" (SETUP.md, step 5). Optional:
  // without these, members can still paste Google Drive links into pages.
  google: {
    oauthClientId: '',     // OAuth 2.0 Web client ID, ends in .apps.googleusercontent.com
    pickerApiKey: '',      // Browser API key restricted to the Picker and Drive APIs
    projectNumber: '',     // Google Cloud project number (IAM & Admin > Settings)
  },

  // Optional extra protection (SETUP.md, "Hardening"). reCAPTCHA Enterprise site key for App Check.
  appCheckSiteKey: '',

  contactEmail: 'cccengineeringrenaissance@gmail.com',
};
