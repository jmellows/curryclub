// Import Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    getFirestore,
    collection,
    addDoc,
    updateDoc,
    doc,
    getDoc,
    getDocs,
    setDoc,
    query,
    onSnapshot,
    serverTimestamp,
    orderBy
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

// Global state
let currentUser = null;
let currentRestaurant = null;
let allRestaurants = [];

// Page navigation
function showPage(pageName) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageName + 'Page').classList.add('active');

    if (pageName === 'detail') {
        document.getElementById('detailPage').classList.add('flip-in');
        setTimeout(() => {
            document.getElementById('detailPage').classList.remove('flip-in');
        }, 600);
    }
}

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

// Auth: Show login/signup forms
document.getElementById('showSignup')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginFormContainer').classList.add('hidden');
    document.getElementById('signupFormContainer').classList.remove('hidden');
    document.getElementById('authError').classList.add('hidden');
});

document.getElementById('showLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('signupFormContainer').classList.add('hidden');
    document.getElementById('loginFormContainer').classList.remove('hidden');
    document.getElementById('authError').classList.add('hidden');
});

// Auth: Login
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    showLoading();
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle the redirect
    } catch (error) {
        hideLoading();
        const errorDiv = document.getElementById('authError');
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    }
});

// Auth: Signup
document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const name = document.getElementById('signupName').value;

    showLoading();
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        // onAuthStateChanged will handle the redirect
    } catch (error) {
        hideLoading();
        const errorDiv = document.getElementById('authError');
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    }
});

// Auth: Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        showPage('login');
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Auth state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        hideLoading();
        showPage('dashboard');
        loadDashboard();
    } else {
        currentUser = null;
        hideLoading();
        showPage('login');
    }
});

// Create interactive stars
function createStarRating(containerId, initialValue = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    const category = container.dataset.category;

    for (let i = 1; i <= 10; i++) {
        const star = document.createElement('span');
        star.className = 'star' + (i <= initialValue ? ' filled' : '');
        star.textContent = '⭐';
        star.dataset.value = i;

        star.addEventListener('click', () => {
            const stars = container.querySelectorAll('.star');
            stars.forEach((s, index) => {
                if (index < i) {
                    s.classList.add('filled');
                } else {
                    s.classList.remove('filled');
                }
            });

            // Update rating value display
            const valueElement = document.getElementById(containerId.replace('Stars', 'Value'));
            if (valueElement) {
                valueElement.textContent = `${i}/10`;
            }
        });

        container.appendChild(star);
    }
}

// Load dashboard
async function loadDashboard() {
    // Listen to restaurants collection
    const restaurantsQuery = query(collection(db, 'restaurants'));

    onSnapshot(restaurantsQuery, async (snapshot) => {
        allRestaurants = [];

        for (const doc of snapshot.docs) {
            const restaurant = { id: doc.id, ...doc.data() };

            // Calculate average ratings
            const ratingsSnapshot = await getDocs(collection(db, 'restaurants', doc.id, 'ratings'));
            const ratings = { meal: [], bathroom: [], ambiance: [], service: [] };

            ratingsSnapshot.forEach(ratingDoc => {
                const rating = ratingDoc.data();
                ratings.meal.push(rating.meal || 0);
                ratings.bathroom.push(rating.bathroom || 0);
                ratings.ambiance.push(rating.ambiance || 0);
                ratings.service.push(rating.service || 0);
            });

            const avgMeal = ratings.meal.length ? ratings.meal.reduce((a, b) => a + b, 0) / ratings.meal.length : 0;
            const avgBathroom = ratings.bathroom.length ? ratings.bathroom.reduce((a, b) => a + b, 0) / ratings.bathroom.length : 0;
            const avgAmbiance = ratings.ambiance.length ? ratings.ambiance.reduce((a, b) => a + b, 0) / ratings.ambiance.length : 0;
            const avgService = ratings.service.length ? ratings.service.reduce((a, b) => a + b, 0) / ratings.service.length : 0;

            const overallAvg = (avgMeal + avgBathroom + avgAmbiance + avgService) / 4;

            restaurant.averageRatings = {
                meal: avgMeal,
                bathroom: avgBathroom,
                ambiance: avgAmbiance,
                service: avgService,
                overall: overallAvg
            };
            restaurant.ratingCount = ratingsSnapshot.size;

            allRestaurants.push(restaurant);
        }

        // Sort by overall average
        allRestaurants.sort((a, b) => b.averageRatings.overall - a.averageRatings.overall);

        renderDashboard();
        await loadTonightsPick();
    });
}

// Render dashboard
function renderDashboard() {
    // Update stats
    document.getElementById('totalRestaurants').textContent = allRestaurants.length;
    const totalRatings = allRestaurants.reduce((sum, r) => sum + r.ratingCount, 0);
    document.getElementById('totalRatings').textContent = totalRatings;

    if (allRestaurants.length > 0) {
        const overallAvg = allRestaurants.reduce((sum, r) => sum + r.averageRatings.overall, 0) / allRestaurants.length;
        document.getElementById('overallAverage').textContent = overallAvg.toFixed(1);
    } else {
        document.getElementById('overallAverage').textContent = '0.0';
    }

    // Show/hide empty state
    if (allRestaurants.length === 0) {
        document.getElementById('emptyState').classList.remove('hidden');
        document.querySelector('.podium-section').style.display = 'none';
    } else {
        document.getElementById('emptyState').classList.add('hidden');
        document.querySelector('.podium-section').style.display = 'block';

        // Render podium (top 3)
        const podiumItems = document.querySelectorAll('.podium-item');
        podiumItems.forEach((item) => {
            const rank = parseInt(item.dataset.rank);
            const restaurant = allRestaurants[rank - 1];

            if (restaurant) {
                item.style.display = 'flex';
                const nameEl = item.querySelector('.restaurant-name');
                const numberEl = item.querySelector('.rating-number');

                nameEl.textContent = restaurant.name;
                numberEl.textContent = restaurant.averageRatings.overall.toFixed(1) + '/10';

                item.onclick = () => showRestaurantDetail(restaurant);
            } else {
                item.style.display = 'none';
            }
        });
    }

    // Render list (4th onwards)
    const listContainer = document.getElementById('restaurantList');
    listContainer.innerHTML = '';

    for (let i = 3; i < allRestaurants.length; i++) {
        const restaurant = allRestaurants[i];
        const card = document.createElement('div');
        card.className = 'list-card';

        card.innerHTML = `
            <div class="list-rank">${i + 1}</div>
            <div class="list-info">
                <div class="list-name">${restaurant.name}</div>
                <div class="list-subtitle">${restaurant.ratingCount} rating${restaurant.ratingCount !== 1 ? 's' : ''}</div>
            </div>
            <div class="list-rating">
                <div class="rating-number">${restaurant.averageRatings.overall.toFixed(1)}/10</div>
            </div>
        `;

        card.onclick = () => showRestaurantDetail(restaurant);
        listContainer.appendChild(card);
    }
}

// Load tonight's pick
async function loadTonightsPick() {
    try {
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        if (pickDoc.exists() && pickDoc.data().restaurantId) {
            const restaurantId = pickDoc.data().restaurantId;
            const restaurant = allRestaurants.find(r => r.id === restaurantId);

            if (restaurant) {
                document.getElementById('tonightsPickSection').classList.remove('hidden');
                document.getElementById('tonightsPickName').textContent = restaurant.name;
                document.getElementById('tonightsPickRating').textContent =
                    `Average: ${restaurant.averageRatings.overall.toFixed(1)}/10`;

                document.getElementById('rateTonightsPick').onclick = () => showRestaurantDetail(restaurant);
            } else {
                document.getElementById('tonightsPickSection').classList.add('hidden');
            }
        } else {
            document.getElementById('tonightsPickSection').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error loading tonight\'s pick:', error);
    }
}

// Show restaurant detail
async function showRestaurantDetail(restaurant) {
    currentRestaurant = restaurant;

    document.getElementById('detailRestaurantName').textContent = restaurant.name;

    // Check if this is tonight's pick
    try {
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        const isTonightsPick = pickDoc.exists() && pickDoc.data().restaurantId === restaurant.id;

        const toggleBtn = document.getElementById('setTonightsPick');
        const toggleText = document.getElementById('tonightsPickText');

        if (isTonightsPick) {
            toggleBtn.classList.add('active');
            toggleText.textContent = 'Remove from Tonight\'s Pick';
        } else {
            toggleBtn.classList.remove('active');
            toggleText.textContent = 'Set as Tonight\'s Pick';
        }
    } catch (error) {
        console.error('Error checking tonight\'s pick:', error);
    }

    // Show average ratings
    document.getElementById('mealAverage').textContent =
        `Club Average: ${restaurant.averageRatings.meal.toFixed(1)}/10`;
    document.getElementById('bathroomAverage').textContent =
        `Club Average: ${restaurant.averageRatings.bathroom.toFixed(1)}/10`;
    document.getElementById('ambianceAverage').textContent =
        `Club Average: ${restaurant.averageRatings.ambiance.toFixed(1)}/10`;
    document.getElementById('serviceAverage').textContent =
        `Club Average: ${restaurant.averageRatings.service.toFixed(1)}/10`;

    // Load user's rating if exists
    try {
        const userRatingDoc = await getDoc(doc(db, 'restaurants', restaurant.id, 'ratings', currentUser.uid));

        if (userRatingDoc.exists()) {
            const userRating = userRatingDoc.data();
            document.getElementById('userRatingStatus').textContent =
                'You have already rated this restaurant. You can update your rating below.';
            document.getElementById('userRatingStatus').classList.remove('hidden');

            createStarRating('mealStars', userRating.meal || 0);
            createStarRating('bathroomStars', userRating.bathroom || 0);
            createStarRating('ambianceStars', userRating.ambiance || 0);
            createStarRating('serviceStars', userRating.service || 0);

            document.getElementById('mealValue').textContent = `${userRating.meal || 0}/10`;
            document.getElementById('bathroomValue').textContent = `${userRating.bathroom || 0}/10`;
            document.getElementById('ambianceValue').textContent = `${userRating.ambiance || 0}/10`;
            document.getElementById('serviceValue').textContent = `${userRating.service || 0}/10`;
        } else {
            document.getElementById('userRatingStatus').classList.add('hidden');

            createStarRating('mealStars', 0);
            createStarRating('bathroomStars', 0);
            createStarRating('ambianceStars', 0);
            createStarRating('serviceStars', 0);

            document.getElementById('mealValue').textContent = '0/10';
            document.getElementById('bathroomValue').textContent = '0/10';
            document.getElementById('ambianceValue').textContent = '0/10';
            document.getElementById('serviceValue').textContent = '0/10';
        }
    } catch (error) {
        console.error('Error loading user rating:', error);
    }

    showPage('detail');
}

// Back button
document.getElementById('backBtn').addEventListener('click', () => {
    showPage('dashboard');
});

// Set/remove tonight's pick
document.getElementById('setTonightsPick').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    try {
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        const isTonightsPick = pickDoc.exists() && pickDoc.data().restaurantId === currentRestaurant.id;

        if (isTonightsPick) {
            // Remove from tonight's pick
            await setDoc(doc(db, 'tonightsPick', 'current'), { restaurantId: null });
            showToast('Removed from Tonight\'s Pick');

            document.getElementById('setTonightsPick').classList.remove('active');
            document.getElementById('tonightsPickText').textContent = 'Set as Tonight\'s Pick';
        } else {
            // Set as tonight's pick
            await setDoc(doc(db, 'tonightsPick', 'current'), {
                restaurantId: currentRestaurant.id,
                updatedAt: serverTimestamp()
            });
            showToast('Set as Tonight\'s Pick!');

            document.getElementById('setTonightsPick').classList.add('active');
            document.getElementById('tonightsPickText').textContent = 'Remove from Tonight\'s Pick';
        }

        await loadTonightsPick();
    } catch (error) {
        console.error('Error toggling tonight\'s pick:', error);
        showToast('Error updating Tonight\'s Pick');
    }
});

// Submit rating
document.getElementById('submitRating').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    const meal = document.querySelectorAll('#mealStars .star.filled').length;
    const bathroom = document.querySelectorAll('#bathroomStars .star.filled').length;
    const ambiance = document.querySelectorAll('#ambianceStars .star.filled').length;
    const service = document.querySelectorAll('#serviceStars .star.filled').length;

    if (meal === 0 || bathroom === 0 || ambiance === 0 || service === 0) {
        showToast('Please rate all categories');
        return;
    }

    showLoading();
    try {
        await setDoc(doc(db, 'restaurants', currentRestaurant.id, 'ratings', currentUser.uid), {
            meal,
            bathroom,
            ambiance,
            service,
            userId: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            updatedAt: serverTimestamp()
        });

        hideLoading();
        showToast('Rating saved!');

        setTimeout(() => {
            showPage('dashboard');
        }, 1500);
    } catch (error) {
        hideLoading();
        console.error('Error saving rating:', error);
        showToast('Error saving rating');
    }
});

// Add restaurant modal
document.getElementById('addRestaurantBtn').addEventListener('click', () => {
    document.getElementById('addRestaurantModal').classList.add('active');
    document.getElementById('restaurantName').value = '';

    // Reset star ratings
    createStarRating('addMealStars', 0);
    createStarRating('addBathroomStars', 0);
    createStarRating('addAmbianceStars', 0);
    createStarRating('addServiceStars', 0);

    document.getElementById('addMealValue').textContent = '0/10';
    document.getElementById('addBathroomValue').textContent = '0/10';
    document.getElementById('addAmbianceValue').textContent = '0/10';
    document.getElementById('addServiceValue').textContent = '0/10';
});

document.getElementById('closeAddModal').addEventListener('click', () => {
    document.getElementById('addRestaurantModal').classList.remove('active');
});

// Add restaurant form
document.getElementById('addRestaurantForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('restaurantName').value.trim();
    if (!name) return;

    const meal = document.querySelectorAll('#addMealStars .star.filled').length;
    const bathroom = document.querySelectorAll('#addBathroomStars .star.filled').length;
    const ambiance = document.querySelectorAll('#addAmbianceStars .star.filled').length;
    const service = document.querySelectorAll('#addServiceStars .star.filled').length;

    showLoading();
    try {
        // Add restaurant
        const restaurantRef = await addDoc(collection(db, 'restaurants'), {
            name,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp()
        });

        // Add rating if provided
        if (meal > 0 && bathroom > 0 && ambiance > 0 && service > 0) {
            await setDoc(doc(db, 'restaurants', restaurantRef.id, 'ratings', currentUser.uid), {
                meal,
                bathroom,
                ambiance,
                service,
                userId: currentUser.uid,
                userName: currentUser.displayName || currentUser.email,
                updatedAt: serverTimestamp()
            });
        }

        hideLoading();
        document.getElementById('addRestaurantModal').classList.remove('active');
        showToast('Restaurant added!');
    } catch (error) {
        hideLoading();
        console.error('Error adding restaurant:', error);
        showToast('Error adding restaurant');
    }
});

// Initialize
console.log('Beachlands Curry Club initialized');
