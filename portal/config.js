// Member portal settings. Fill these in once, after creating the Firebase project (SETUP.md, step 2).
//
// None of these values are secrets. Every Firebase web app ships its config to the browser;
// the data stays protected by the Firestore security rules (firebase/firestore.rules) and by
// restricting the API keys to engineeringrenaissance.org in Google Cloud.
//
// While firebase.apiKey is blank, the portal shows a setup notice and a demo with sample data.

export default {
  firebase: {
    apiKey: 'AIzaSyD9Yd7db8vl2KiTZN-7SMSyNM4oUvUKmR8',
    authDomain: 'er-portal-19d4a.firebaseapp.com',        // e.g. 'er-portal.firebaseapp.com'
    projectId: 'er-portal-19d4a',         // e.g. 'er-portal'
    appId: '1:152424240260:web:4f604115d2b05114695ed1',
    messagingSenderId: '152424240260',
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
