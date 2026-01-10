// Import Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    serverTimestamp,
    query,
    orderBy,
    onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBUHbaZnPKBA4pZ5YRwZmHwoB-68I5LKEg",
    authDomain: "beachlands-curry-club.firebaseapp.com",
    projectId: "beachlands-curry-club",
    storageBucket: "beachlands-curry-club.firebasestorage.app",
    messagingSenderId: "797609017294",
    appId: "1:797609017294:web:e7161e1442036a483ff59f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;

// Toast notification
function showToast(message) {
    const toast = document.getElementById('successToast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

// Loading spinner
function showLoading() {
    document.getElementById('loadingSpinner').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingSpinner').classList.add('hidden');
}

// Auth check
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadWhitelist();
    } else {
        // Redirect to login if not authenticated
        window.location.href = '/';
    }
});

// Load whitelist
function loadWhitelist() {
    const whitelistQuery = query(collection(db, 'whitelist'));

    onSnapshot(whitelistQuery, (snapshot) => {
        const container = document.getElementById('whitelistContainer');

        if (snapshot.empty) {
            container.innerHTML = '<p class="empty-message">No whitelisted emails yet. Add one above!</p>';
            return;
        }

        const emails = [];
        snapshot.forEach(doc => {
            emails.push({ id: doc.id, ...doc.data() });
        });

        // Sort by email
        emails.sort((a, b) => a.email.localeCompare(b.email));

        let html = '<table class="whitelist-table">';
        html += '<thead><tr><th>Email</th><th>Added</th><th>Action</th></tr></thead>';
        html += '<tbody>';

        emails.forEach(item => {
            const addedDate = item.addedAt ? new Date(item.addedAt.toDate()).toLocaleDateString() : 'Unknown';
            html += `
                <tr>
                    <td>${item.email}</td>
                    <td>${addedDate}</td>
                    <td>
                        <button class="delete-btn" onclick="deleteEmail('${item.id}')">Remove</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    });
}

// Create new user account
document.getElementById('createAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('accountEmail').value.trim().toLowerCase();
    const password = document.getElementById('accountPassword').value;
    const name = document.getElementById('accountName').value.trim();

    if (!email || !password || !name) return;

    if (!confirm(`Create account for ${email}?\n\nNote: You will be temporarily logged out and need to log back in.`)) {
        return;
    }

    showLoading();
    try {
        // First, add to whitelist
        await setDoc(doc(db, 'whitelist', email), {
            email: email,
            addedBy: currentUser.uid,
            addedByEmail: currentUser.email,
            addedAt: serverTimestamp()
        });

        // Create Firebase Auth account (this will log current admin out)
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });

        // Sign out the newly created user
        await signOut(auth);

        hideLoading();

        // Clear form
        document.getElementById('accountEmail').value = '';
        document.getElementById('accountPassword').value = '';
        document.getElementById('accountName').value = '';

        // Show success message and redirect to login
        alert(`Account created successfully for ${email}!\n\nYou have been logged out. Please log back in.`);
        window.location.href = '/';
    } catch (error) {
        hideLoading();
        console.error('Error creating account:', error);

        let errorMessage = 'Error creating account';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'This email already has an account';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Password should be at least 6 characters';
        } else if (error.message) {
            errorMessage = error.message;
        }

        showToast(errorMessage);
    }
});

// Add email to whitelist
document.getElementById('addEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('newEmail').value.trim().toLowerCase();

    if (!email) return;

    showLoading();
    try {
        await setDoc(doc(db, 'whitelist', email), {
            email: email,
            addedBy: currentUser.uid,
            addedByEmail: currentUser.email,
            addedAt: serverTimestamp()
        });

        document.getElementById('newEmail').value = '';
        hideLoading();
        showToast('Email added to whitelist!');
    } catch (error) {
        hideLoading();
        console.error('Error adding email:', error);
        showToast('Error adding email');
    }
});

// Delete email from whitelist (global function for onclick)
window.deleteEmail = async function(emailId) {
    if (!confirm(`Remove ${emailId} from whitelist?`)) return;

    showLoading();
    try {
        await deleteDoc(doc(db, 'whitelist', emailId));
        hideLoading();
        showToast('Email removed from whitelist');
    } catch (error) {
        hideLoading();
        console.error('Error removing email:', error);
        showToast('Error removing email');
    }
};

console.log('Admin panel initialized');
