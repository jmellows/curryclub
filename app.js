// Import Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
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
    deleteDoc,
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

// Admin email - only this user can delete restaurants
const ADMIN_EMAIL = "jmellowsjnr@gmail.com"; // Change this to your admin email

// Global state
let currentUser = null;
let currentRestaurant = null;
let currentUserRating = null; // Store user's rating for the current restaurant
let allRestaurants = [];
let uniqueMembers = new Set(); // Track unique member user IDs
let unsubscribeRestaurants = null; // Store unsubscribe function for restaurants listener
let unsubscribeNotifications = null; // Store unsubscribe function for notifications listener
let isLoadingRestaurants = false; // Prevent concurrent loads
let previousRatingValues = { meal: 0, bathroom: 0, ambiance: 0, service: 0 }; // Track previous values for notification triggers

// Page navigation
function showPage(pageName) {
    const targetPage = document.getElementById(pageName + 'Page');

    // For detail page, add flip animation class BEFORE making it active
    if (pageName === 'detail') {
        targetPage.classList.add('flip-in');
        // Use requestAnimationFrame to ensure the class is applied before transition
        requestAnimationFrame(() => {
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
            targetPage.classList.add('active');
        });

        // Remove flip class after animation completes
        setTimeout(() => {
            targetPage.classList.remove('flip-in');
        }, 600);
    } else {
        // For other pages, just do normal transition
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        targetPage.classList.add('active');
    }
}

// Toast notification with swipe-to-dismiss
function showToast(message) {
    const toast = document.getElementById('successToast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';

    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let autoHideTimer;

    // Clear any existing listeners by cloning and replacing
    const newToast = toast.cloneNode(true);
    toast.parentNode.replaceChild(newToast, toast);
    const activeToast = document.getElementById('successToast');
    document.getElementById('toastMessage').textContent = message;

    const hideToast = () => {
        activeToast.classList.remove('show');
        setTimeout(() => activeToast.classList.add('hidden'), 300);
        clearTimeout(autoHideTimer);
    };

    const handleStart = (e) => {
        isDragging = true;
        startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        clearTimeout(autoHideTimer);
        activeToast.style.transition = 'none';
    };

    const handleMove = (e) => {
        if (!isDragging) return;
        currentX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const deltaX = currentX - startX;
        const opacity = Math.max(0, 1 - Math.abs(deltaX) / 200);

        activeToast.style.transform = `translateX(calc(-50% + ${deltaX}px)) translateY(0)`;
        activeToast.style.opacity = opacity;
    };

    const handleEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        const deltaX = currentX - startX;

        activeToast.style.transition = 'transform 0.3s ease, opacity 0.3s ease';

        // If swiped more than 100px, dismiss it
        if (Math.abs(deltaX) > 100) {
            const direction = deltaX > 0 ? 1 : -1;
            activeToast.style.transform = `translateX(calc(-50% + ${direction * 400}px)) translateY(0)`;
            activeToast.style.opacity = '0';
            setTimeout(hideToast, 300);
        } else {
            // Snap back to center
            activeToast.style.transform = 'translateX(-50%) translateY(0)';
            activeToast.style.opacity = '1';
            // Resume auto-hide
            autoHideTimer = setTimeout(hideToast, 3000);
        }
    };

    // Touch events
    activeToast.addEventListener('touchstart', handleStart);
    activeToast.addEventListener('touchmove', handleMove);
    activeToast.addEventListener('touchend', handleEnd);

    // Mouse events
    activeToast.addEventListener('mousedown', handleStart);
    activeToast.addEventListener('mousemove', handleMove);
    activeToast.addEventListener('mouseup', handleEnd);
    activeToast.addEventListener('mouseleave', handleEnd);

    // Auto-hide after 3 seconds
    autoHideTimer = setTimeout(hideToast, 3000);
}

// Loading spinner
function showLoading() {
    document.getElementById('loadingSpinner').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingSpinner').classList.add('hidden');
}

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

// Auth: Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        showPage('login');
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Session tracking
let sessionStartTime = null;
let activityUpdateInterval = null;

async function trackUserSession(user) {
    if (!user) return;

    sessionStartTime = Date.now();

    // Record login session
    try {
        const sessionData = {
            userId: user.uid,
            userName: user.displayName || user.email,
            loginTime: serverTimestamp(),
            lastActivity: serverTimestamp()
        };

        await setDoc(doc(db, 'sessions', user.uid), sessionData, { merge: true });
    } catch (error) {
        console.error('Error tracking session:', error);
    }

    // Update last activity every 30 seconds
    if (activityUpdateInterval) clearInterval(activityUpdateInterval);

    activityUpdateInterval = setInterval(async () => {
        try {
            await updateDoc(doc(db, 'sessions', user.uid), {
                lastActivity: serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating activity:', error);
        }
    }, 30000); // 30 seconds
}

async function endUserSession(user) {
    if (!user || !sessionStartTime) return;

    try {
        const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000); // in seconds

        // Add to session history
        await addDoc(collection(db, 'sessions', user.uid, 'history'), {
            loginTime: new Date(sessionStartTime),
            duration: sessionDuration,
            logoutTime: serverTimestamp()
        });

        // Clear activity interval
        if (activityUpdateInterval) {
            clearInterval(activityUpdateInterval);
            activityUpdateInterval = null;
        }
    } catch (error) {
        console.error('Error ending session:', error);
    }
}

// Notification listener - broadcasts funny notifications to all users
function setupNotificationListener() {
    // Unsubscribe from previous listener if exists
    if (unsubscribeNotifications) {
        unsubscribeNotifications();
    }

    // Listen for new notifications from the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const notificationsQuery = query(
        collection(db, 'notifications'),
        orderBy('timestamp', 'desc')
    );

    unsubscribeNotifications = onSnapshot(notificationsQuery, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const notification = change.doc.data();
                const notificationTime = notification.timestamp?.toDate();

                // Only show notifications from the last 5 minutes
                if (notificationTime && notificationTime > fiveMinutesAgo) {
                    console.log('📢 New notification received:', notification.message);
                    showToast(notification.message);
                }
            }
        });
    });
}

// Auth state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        hideLoading();

        // Track session
        trackUserSession(user);

        // Listen for notifications
        setupNotificationListener();

        // Show/hide admin menu link
        const adminLink = document.getElementById('menuAdminLink');
        if (user.email === ADMIN_EMAIL) {
            adminLink.classList.remove('hidden');
        } else {
            adminLink.classList.add('hidden');
        }

        showPage('dashboard');
        loadDashboard();
    } else {
        // End session if logging out
        if (currentUser) {
            endUserSession(currentUser);
        }

        // Unsubscribe from notifications
        if (unsubscribeNotifications) {
            unsubscribeNotifications();
            unsubscribeNotifications = null;
        }

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
        star.textContent = i <= initialValue ? '⭐' : '☆';
        star.dataset.value = i;

        star.addEventListener('click', async () => {
            const stars = container.querySelectorAll('.star');
            stars.forEach((s, index) => {
                if (index < i) {
                    s.classList.add('filled');
                    s.textContent = '⭐';
                } else {
                    s.classList.remove('filled');
                    s.textContent = '☆';
                }
            });

            // Update rating value display
            const valueElement = document.getElementById(containerId.replace('Stars', 'Value'));
            if (valueElement) {
                valueElement.textContent = `${i}/10`;
            }

            // Auto-save rating if on detail page (not in add modal)
            if (containerId.includes('meal') || containerId.includes('bathroom') ||
                containerId.includes('ambiance') || containerId.includes('service')) {
                if (!containerId.includes('add') && currentRestaurant) {
                    await saveRatingToFirebase();
                }
            }
        });

        container.appendChild(star);
    }
}

// Refresh dashboard data (called when returning from detail page)
async function refreshDashboardData() {
    if (isLoadingRestaurants) return;
    isLoadingRestaurants = true;

    try {
        const restaurantsSnapshot = await getDocs(collection(db, 'restaurants'));
        allRestaurants = [];
        uniqueMembers.clear(); // Reset unique members count

        for (const doc of restaurantsSnapshot.docs) {
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

                // Track unique members
                if (rating.userId) {
                    uniqueMembers.add(rating.userId);
                }
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

        // Filter out restaurants with no ratings and sort by overall average
        allRestaurants = allRestaurants.filter(r => r.ratingCount > 0);
        allRestaurants.sort((a, b) => b.averageRatings.overall - a.averageRatings.overall);

        renderDashboard();
        await loadTonightsPick();
    } finally {
        isLoadingRestaurants = false;
    }
}

// Load dashboard
async function loadDashboard() {
    // Clean up existing listener if it exists
    if (unsubscribeRestaurants) {
        unsubscribeRestaurants();
    }

    // Listen to restaurants collection
    const restaurantsQuery = query(collection(db, 'restaurants'));

    unsubscribeRestaurants = onSnapshot(restaurantsQuery, async (snapshot) => {
        console.log('🔄 Listener fired! Restaurants in DB:', snapshot.docs.length);
        allRestaurants = [];
        uniqueMembers.clear(); // Reset unique members count

        for (const doc of snapshot.docs) {
            const restaurant = { id: doc.id, ...doc.data() };
            console.log('  📍 Found:', restaurant.name);

            // Calculate average ratings
            const ratingsSnapshot = await getDocs(collection(db, 'restaurants', doc.id, 'ratings'));
            const ratings = { meal: [], bathroom: [], ambiance: [], service: [] };

            ratingsSnapshot.forEach(ratingDoc => {
                const rating = ratingDoc.data();
                ratings.meal.push(rating.meal || 0);
                ratings.bathroom.push(rating.bathroom || 0);
                ratings.ambiance.push(rating.ambiance || 0);
                ratings.service.push(rating.service || 0);

                // Track unique members
                if (rating.userId) {
                    uniqueMembers.add(rating.userId);
                }
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

        // Filter out restaurants with no ratings and sort by overall average
        allRestaurants = allRestaurants.filter(r => r.ratingCount > 0);
        allRestaurants.sort((a, b) => b.averageRatings.overall - a.averageRatings.overall);

        renderDashboard();
        await loadTonightsPick();
    });
}

// Render dashboard
function renderDashboard() {
    // Update stats
    document.getElementById('totalRestaurants').textContent = allRestaurants.length;
    document.getElementById('totalRatings').textContent = uniqueMembers.size;

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
                document.getElementById('tonightsPickName').textContent = restaurant.name.toLowerCase();
                document.getElementById('tonightsPickRating').textContent =
                    `${restaurant.averageRatings.overall.toFixed(1)}/10`;

                // Check if restaurant is locked
                const isLocked = restaurant.isLocked || false;
                const lockIcon = document.getElementById('tonightsPickLock');
                const rateButton = document.getElementById('rateTonightsPick');

                if (isLocked) {
                    lockIcon.textContent = '🔒';
                    rateButton.style.display = 'none';
                } else {
                    lockIcon.textContent = '🔓';
                    rateButton.style.display = 'inline-block';
                }

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

    // Set basic info immediately
    document.getElementById('detailRestaurantName').textContent = restaurant.name;

    // Show average ratings immediately
    document.getElementById('mealAverage').textContent =
        `${restaurant.averageRatings.meal.toFixed(1)}/10`;
    document.getElementById('bathroomAverage').textContent =
        `${restaurant.averageRatings.bathroom.toFixed(1)}/10`;
    document.getElementById('ambianceAverage').textContent =
        `${restaurant.averageRatings.ambiance.toFixed(1)}/10`;
    document.getElementById('serviceAverage').textContent =
        `${restaurant.averageRatings.service.toFixed(1)}/10`;

    // Initialize sliders immediately
    document.getElementById('mealSlider').value = 0;
    document.getElementById('bathroomSlider').value = 0;
    document.getElementById('ambianceSlider').value = 0;
    document.getElementById('serviceSlider').value = 0;

    document.getElementById('mealValue').textContent = '0';
    document.getElementById('bathroomValue').textContent = '0';
    document.getElementById('ambianceValue').textContent = '0';
    document.getElementById('serviceValue').textContent = '0';

    // Update chili positions
    ['meal', 'service', 'ambiance', 'bathroom'].forEach(category => {
        const slider = document.getElementById(`${category}Slider`);
        slider.dispatchEvent(new Event('input'));
    });

    // Reset current user rating
    currentUserRating = null;

    // Reset previous rating values for notification triggers
    previousRatingValues = { meal: 0, bathroom: 0, ambiance: 0, service: 0 };

    // Reset overall average display
    document.getElementById('overallAverageValue').textContent = '-';


    // Show/hide admin buttons for admin only
    const deleteBtn = document.getElementById('deleteRestaurantBtn');
    const lockBtn = document.getElementById('lockRestaurantBtn');

    if (currentUser && currentUser.email === ADMIN_EMAIL) {
        deleteBtn.classList.remove('hidden');
        lockBtn.classList.remove('hidden');
    } else {
        deleteBtn.classList.add('hidden');
        lockBtn.classList.add('hidden');
    }

    // Check if restaurant is locked and disable sliders
    const isLocked = restaurant.isLocked || false;
    const sliders = ['mealSlider', 'bathroomSlider', 'ambianceSlider', 'serviceSlider'];

    sliders.forEach(sliderId => {
        const slider = document.getElementById(sliderId);
        if (isLocked && currentUser.email !== ADMIN_EMAIL) {
            slider.disabled = true;
        } else {
            slider.disabled = false;
        }
    });

    // Update lock button icon
    if (isLocked) {
        lockBtn.textContent = '🔒';
        lockBtn.classList.add('locked');
    } else {
        lockBtn.textContent = '🔓';
        lockBtn.classList.remove('locked');
    }

    // FLIP TO DETAIL PAGE IMMEDIATELY
    showPage('detail');

    // Load data in background while flip animation plays
    // Check if this is tonight's pick
    getDoc(doc(db, 'tonightsPick', 'current')).then(pickDoc => {
        const isTonightsPick = pickDoc.exists() && pickDoc.data().restaurantId === restaurant.id;

        const toggleBtn = document.getElementById('setTonightsPick');

        if (isTonightsPick) {
            toggleBtn.classList.add('active');
            toggleBtn.textContent = '⭐';
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = '☆';
        }
    }).catch(error => {
        console.error('Error checking tonight\'s pick:', error);
    });

    // Load user's rating if exists
    console.log('🔍 Loading rating for user:', currentUser.uid, 'restaurant:', restaurant.id);
    getDoc(doc(db, 'restaurants', restaurant.id, 'ratings', currentUser.uid)).then(userRatingDoc => {
        console.log('📥 Rating doc exists?', userRatingDoc.exists());
        if (userRatingDoc.exists()) {
            const userRating = userRatingDoc.data();
            console.log('✅ User rating loaded:', userRating);
            currentUserRating = userRating; // Store for toggle functionality

            document.getElementById('mealSlider').value = userRating.meal || 0;
            document.getElementById('bathroomSlider').value = userRating.bathroom || 0;
            document.getElementById('ambianceSlider').value = userRating.ambiance || 0;
            document.getElementById('serviceSlider').value = userRating.service || 0;

            document.getElementById('mealValue').textContent = (userRating.meal || 0).toFixed(1);
            document.getElementById('bathroomValue').textContent = (userRating.bathroom || 0).toFixed(1);
            document.getElementById('ambianceValue').textContent = (userRating.ambiance || 0).toFixed(1);
            document.getElementById('serviceValue').textContent = (userRating.service || 0).toFixed(1);

            // Update chili positions after loading ratings
            ['meal', 'service', 'ambiance', 'bathroom'].forEach(category => {
                const slider = document.getElementById(`${category}Slider`);
                slider.dispatchEvent(new Event('input'));
            });

            // Calculate and display overall average
            const overallAvg = ((userRating.meal + userRating.bathroom + userRating.ambiance + userRating.service) / 4).toFixed(1);
            document.getElementById('overallAverageValue').textContent = `${overallAvg}/10`;

            // Set previous rating values to current loaded values
            previousRatingValues = {
                meal: userRating.meal || 0,
                bathroom: userRating.bathroom || 0,
                ambiance: userRating.ambiance || 0,
                service: userRating.service || 0
            };
        } else {
            console.log('ℹ️ No existing rating found for this user');
            currentUserRating = null;

            // If restaurant is locked, show community averages instead of zeros
            const isLocked = currentRestaurant.isLocked || false;
            if (isLocked && currentUser.email !== ADMIN_EMAIL) {
                // Show community averages in the disabled sliders
                document.getElementById('mealSlider').value = currentRestaurant.averageRatings.meal;
                document.getElementById('bathroomSlider').value = currentRestaurant.averageRatings.bathroom;
                document.getElementById('ambianceSlider').value = currentRestaurant.averageRatings.ambiance;
                document.getElementById('serviceSlider').value = currentRestaurant.averageRatings.service;

                document.getElementById('mealValue').textContent = currentRestaurant.averageRatings.meal.toFixed(1);
                document.getElementById('bathroomValue').textContent = currentRestaurant.averageRatings.bathroom.toFixed(1);
                document.getElementById('ambianceValue').textContent = currentRestaurant.averageRatings.ambiance.toFixed(1);
                document.getElementById('serviceValue').textContent = currentRestaurant.averageRatings.service.toFixed(1);

                // Update chili positions
                ['meal', 'service', 'ambiance', 'bathroom'].forEach(category => {
                    const slider = document.getElementById(`${category}Slider`);
                    slider.dispatchEvent(new Event('input'));
                });

                document.getElementById('overallAverageValue').textContent = `${currentRestaurant.averageRatings.overall.toFixed(1)}/10 (locked - community average)`;
            } else {
                document.getElementById('overallAverageValue').textContent = 'Not rated yet - move all 4 sliders to rate';
            }
        }
    }).catch(error => {
        console.error('❌ Error loading user rating:', error);
        console.error('Error details:', error.message, error.code);
    });
}

// Back button
document.getElementById('backBtn').addEventListener('click', async () => {
    const detailPage = document.getElementById('detailPage');

    // Add flip-out animation
    detailPage.classList.add('flip-out');

    // Wait for animation to complete before changing page
    setTimeout(async () => {
        detailPage.classList.remove('flip-out');
        showPage('dashboard');
        // Manually refresh dashboard data since rating changes don't trigger the restaurants listener
        await refreshDashboardData();
    }, 600);
});

// Members back button
document.getElementById('membersBackBtn').addEventListener('click', () => {
    showPage('dashboard');
});

// Navigate to members page
document.getElementById('membersStatBtn').addEventListener('click', () => {
    showPage('members');
    loadMembersPage();
});

// Calculate and display members page
async function loadMembersPage() {
    const memberStats = {};

    // Collect all ratings for all members
    for (const restaurant of allRestaurants) {
        const ratingsSnapshot = await getDocs(collection(db, 'restaurants', restaurant.id, 'ratings'));

        ratingsSnapshot.forEach(ratingDoc => {
            const rating = ratingDoc.data();
            const userId = rating.userId;

            if (!userId) return;

            if (!memberStats[userId]) {
                memberStats[userId] = {
                    userId: userId,
                    name: rating.userName || 'Unknown',
                    ratings: [],
                    categoryTotals: { meal: 0, bathroom: 0, ambiance: 0, service: 0 }
                };
            }

            memberStats[userId].ratings.push({
                meal: rating.meal || 0,
                bathroom: rating.bathroom || 0,
                ambiance: rating.ambiance || 0,
                service: rating.service || 0
            });

            memberStats[userId].categoryTotals.meal += rating.meal || 0;
            memberStats[userId].categoryTotals.bathroom += rating.bathroom || 0;
            memberStats[userId].categoryTotals.ambiance += rating.ambiance || 0;
            memberStats[userId].categoryTotals.service += rating.service || 0;
        });
    }

    // Calculate averages and determine specialists
    const memberArray = Object.values(memberStats).map(member => {
        const totalRatings = member.ratings.length;
        const allRatings = member.ratings.flatMap(r => [r.meal, r.bathroom, r.ambiance, r.service]);
        const avgRating = allRatings.reduce((a, b) => a + b, 0) / allRatings.length;

        // Calculate category averages
        const categoryAvgs = {
            meal: member.categoryTotals.meal / totalRatings,
            bathroom: member.categoryTotals.bathroom / totalRatings,
            ambiance: member.categoryTotals.ambiance / totalRatings,
            service: member.categoryTotals.service / totalRatings
        };

        // Determine specialist (highest category)
        let highestCategory = 'meal';
        let highestAvg = categoryAvgs.meal;
        if (categoryAvgs.bathroom > highestAvg) { highestCategory = 'bathroom'; highestAvg = categoryAvgs.bathroom; }
        if (categoryAvgs.ambiance > highestAvg) { highestCategory = 'ambiance'; highestAvg = categoryAvgs.ambiance; }
        if (categoryAvgs.service > highestAvg) { highestCategory = 'service'; }

        const specialistLabels = {
            meal: 'Meal Master 🍛',
            bathroom: 'Bathroom Buff 🚽',
            ambiance: 'Ambiance Aficionado 🕯️',
            service: 'Service Savant 🙏'
        };

        // Calculate variance for personality trait
        const mean = avgRating;
        const variance = allRatings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / allRatings.length;

        return {
            ...member,
            restaurantsRated: totalRatings,
            avgRating: avgRating,
            specialist: specialistLabels[highestCategory],
            variance: variance
        };
    });

    // Determine personality traits
    if (memberArray.length > 0) {
        const sortedByAvg = [...memberArray].sort((a, b) => a.avgRating - b.avgRating);
        const sortedByVariance = [...memberArray].sort((a, b) => b.variance - a.variance);

        memberArray.forEach(member => {
            // Check if rated all restaurants
            if (member.restaurantsRated === allRestaurants.length && allRestaurants.length > 0) {
                member.trait = 'Completionist ✅';
            }
            // Highest average rater
            else if (member.userId === sortedByAvg[sortedByAvg.length - 1].userId && memberArray.length > 1) {
                member.trait = 'Easy to Please 😊';
            }
            // Lowest average rater
            else if (member.userId === sortedByAvg[0].userId && memberArray.length > 1) {
                member.trait = 'The Critic 🧐';
            }
            // Most variance
            else if (member.userId === sortedByVariance[0].userId && member.variance > 1 && memberArray.length > 1) {
                member.trait = 'Wild Card 🎲';
            }
            // Least variance (consistent)
            else if (member.userId === sortedByVariance[sortedByVariance.length - 1].userId && memberArray.length > 1) {
                member.trait = 'Steady Eddie 🎯';
            }
            // Default
            else {
                member.trait = 'Club Member 🌟';
            }
        });
    }

    // Sort by average rating (highest first)
    memberArray.sort((a, b) => b.avgRating - a.avgRating);

    // Render Table 1: Stats
    const tbody1 = document.getElementById('membersTableBody1');
    tbody1.innerHTML = '';

    memberArray.forEach(member => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${member.name}</td>
            <td class="member-avg-rating">${member.avgRating.toFixed(1)}/10</td>
            <td class="member-rated-count">${member.restaurantsRated}/${allRestaurants.length}</td>
        `;
        tbody1.appendChild(row);
    });

    // Render Table 2: Profiles
    const tbody2 = document.getElementById('membersTableBody2');
    tbody2.innerHTML = '';

    memberArray.forEach(member => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${member.name}</td>
            <td class="member-specialist">${member.specialist}</td>
            <td class="member-trait">${member.trait}</td>
        `;
        tbody2.appendChild(row);
    });
}


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
            document.getElementById('setTonightsPick').textContent = '☆';
        } else {
            // Set as tonight's pick
            await setDoc(doc(db, 'tonightsPick', 'current'), {
                restaurantId: currentRestaurant.id,
                updatedAt: serverTimestamp()
            });
            showToast('Set as Tonight\'s Pick!');

            document.getElementById('setTonightsPick').classList.add('active');
            document.getElementById('setTonightsPick').textContent = '⭐';
        }

        await loadTonightsPick();
    } catch (error) {
        console.error('Error toggling tonight\'s pick:', error);
        showToast('Error updating Tonight\'s Pick');
    }
});

// Lock/Unlock restaurant (admin only)
document.getElementById('lockRestaurantBtn').addEventListener('click', async () => {
    if (!currentRestaurant) return;
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Only admin can lock/unlock restaurants');
        return;
    }

    try {
        const isCurrentlyLocked = currentRestaurant.isLocked || false;
        const newLockStatus = !isCurrentlyLocked;

        // Update restaurant lock status
        await updateDoc(doc(db, 'restaurants', currentRestaurant.id), {
            isLocked: newLockStatus
        });

        // Update current restaurant object
        currentRestaurant.isLocked = newLockStatus;

        // Update UI
        const lockBtn = document.getElementById('lockRestaurantBtn');
        const sliders = ['mealSlider', 'bathroomSlider', 'ambianceSlider', 'serviceSlider'];

        if (newLockStatus) {
            lockBtn.textContent = '🔒';
            lockBtn.classList.add('locked');
            showToast(`${currentRestaurant.name} is now locked - users cannot rate`);
        } else {
            lockBtn.textContent = '🔓';
            lockBtn.classList.remove('locked');
            showToast(`${currentRestaurant.name} is now unlocked - users can rate`);
        }

        // Update slider disabled state (admin can always rate)
        sliders.forEach(sliderId => {
            const slider = document.getElementById(sliderId);
            if (newLockStatus && currentUser.email !== ADMIN_EMAIL) {
                slider.disabled = true;
            } else {
                slider.disabled = false;
            }
        });

    } catch (error) {
        console.error('Error toggling lock:', error);
        showToast('Error updating lock status');
    }
});

// Delete restaurant (admin only)
document.getElementById('deleteRestaurantBtn').addEventListener('click', () => {
    if (!currentRestaurant) return;
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Only admin can delete restaurants');
        return;
    }

    // Show delete confirmation modal
    document.getElementById('deleteRestaurantName').textContent = currentRestaurant.name;
    document.getElementById('deleteConfirmModal').classList.add('active');
});

// Cancel delete
document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    document.getElementById('deleteConfirmModal').classList.remove('active');
});

// Confirm delete
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    // Close modal
    document.getElementById('deleteConfirmModal').classList.remove('active');

    showLoading();
    try {
        // Delete all ratings first
        const ratingsSnapshot = await getDocs(collection(db, 'restaurants', currentRestaurant.id, 'ratings'));
        for (const ratingDoc of ratingsSnapshot.docs) {
            await deleteDoc(ratingDoc.ref);
        }

        // Delete the restaurant
        await deleteDoc(doc(db, 'restaurants', currentRestaurant.id));

        // If this was tonight's pick, remove it
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        if (pickDoc.exists() && pickDoc.data().restaurantId === currentRestaurant.id) {
            await deleteDoc(doc(db, 'tonightsPick', 'current'));
        }

        hideLoading();
        showToast('Restaurant deleted');
        showPage('dashboard');
        // Real-time listener will automatically update the dashboard
    } catch (error) {
        hideLoading();
        console.error('Error deleting restaurant:', error);
        showToast('Error deleting restaurant');
    }
});

// Auto-save rating to Firebase
async function saveRatingToFirebase() {
    if (!currentRestaurant) return;

    // Check if restaurant is locked (non-admin users cannot rate locked restaurants)
    const isLocked = currentRestaurant.isLocked || false;
    if (isLocked && currentUser.email !== ADMIN_EMAIL) {
        showToast('This restaurant is locked - ratings are disabled');
        return;
    }

    const meal = parseFloat(document.getElementById('mealSlider').value);
    const bathroom = parseFloat(document.getElementById('bathroomSlider').value);
    const ambiance = parseFloat(document.getElementById('ambianceSlider').value);
    const service = parseFloat(document.getElementById('serviceSlider').value);

    console.log('💾 Attempting to save rating:', { meal, bathroom, ambiance, service });

    if (meal === 0 || bathroom === 0 || ambiance === 0 || service === 0) {
        console.log('⚠️ Rating not saved - incomplete (has zeros)');
        return; // Don't save incomplete ratings
    }

    try {
        const ratingData = {
            meal,
            bathroom,
            ambiance,
            service,
            userId: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, 'restaurants', currentRestaurant.id, 'ratings', currentUser.uid), ratingData);

        // Update current user rating for toggle functionality
        currentUserRating = { meal, bathroom, ambiance, service };

        // Update overall average display
        const overallAvg = ((meal + bathroom + ambiance + service) / 4).toFixed(1);
        document.getElementById('overallAverageValue').textContent = `${overallAvg}/10`;

        // Funny notification checks - only trigger on threshold crossing
        const userName = currentUser.displayName || currentUser.email.split('@')[0];
        let message = 'Rating saved!';
        let showFunnyNotification = false;

        // Check if we crossed into "all 10s" territory
        const wasAll10s = previousRatingValues.meal === 10 && previousRatingValues.bathroom === 10 &&
                          previousRatingValues.ambiance === 10 && previousRatingValues.service === 10;
        const isAll10s = meal === 10 && bathroom === 10 && ambiance === 10 && service === 10;

        if (isAll10s && !wasAll10s) {
            message = `${userName} is suspiciously easy to please... 🤔`;
            showFunnyNotification = true;
        }
        // Meal rating crossed below 4 (Debby Downer)
        else if (meal < 4 && previousRatingValues.meal >= 4) {
            message = `${userName} is being a Debby Downer on meals! 😢`;
            showFunnyNotification = true;
        }
        // Service rating crossed below 3
        else if (service < 3 && previousRatingValues.service >= 3) {
            message = `${userName} didn't get the royal treatment 👎`;
            showFunnyNotification = true;
        }
        // Bathroom rating crossed above 9
        else if (bathroom > 9 && previousRatingValues.bathroom <= 9) {
            message = `${userName} found their throne! 👑🚽`;
            showFunnyNotification = true;
        }
        // Ambiance rating crossed above 9
        else if (ambiance > 9 && previousRatingValues.ambiance <= 9) {
            message = `${userName} wants to move in! 🏠✨`;
            showFunnyNotification = true;
        }

        // Update previous values for next comparison
        previousRatingValues = { meal, bathroom, ambiance, service };

        // Save notification to Firestore if it's a funny one
        if (showFunnyNotification) {
            try {
                await addDoc(collection(db, 'notifications'), {
                    message: message,
                    restaurantName: currentRestaurant.name,
                    userName: userName,
                    timestamp: serverTimestamp(),
                    read: false
                });
                console.log('📢 Notification broadcast:', message);
            } catch (error) {
                console.error('Error saving notification:', error);
            }
        }

        showToast(message);
    } catch (error) {
        console.error('Error saving rating:', error);
        showToast('Error saving rating');
    }
}

// Submit rating (legacy - now auto-saves)
document.getElementById('submitRating').addEventListener('click', async () => {
    if (!currentRestaurant) return;
    await saveRatingToFirebase();
});

// Add restaurant modal
document.getElementById('addRestaurantBtn').addEventListener('click', () => {
    document.getElementById('addRestaurantModal').classList.add('active');
    document.getElementById('restaurantName').value = '';

    // Reset star ratings
    createStarRating('addMealStars', 0);
    createStarRating('addServiceStars', 0);
    createStarRating('addAmbianceStars', 0);
    createStarRating('addBathroomStars', 0);

    document.getElementById('addMealValue').textContent = '0/10';
    document.getElementById('addServiceValue').textContent = '0/10';
    document.getElementById('addAmbianceValue').textContent = '0/10';
    document.getElementById('addBathroomValue').textContent = '0/10';
});

document.getElementById('closeAddModal').addEventListener('click', () => {
    document.getElementById('addRestaurantModal').classList.remove('active');
});

// Add restaurant form
let isSubmittingRestaurant = false;
document.getElementById('addRestaurantForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (isSubmittingRestaurant) return; // Prevent duplicate submissions
    isSubmittingRestaurant = true;

    const name = document.getElementById('restaurantName').value.trim();
    if (!name) {
        isSubmittingRestaurant = false;
        return;
    }

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
    } finally {
        isSubmittingRestaurant = false;
    }
});

// Slider event listeners for live updates and auto-save
['meal', 'service', 'ambiance', 'bathroom'].forEach(category => {
    const slider = document.getElementById(`${category}Slider`);
    const valueDisplay = document.getElementById(`${category}Value`);

    // Create chili emoji indicator
    const chili = document.createElement('div');
    chili.className = 'slider-chili';
    chili.textContent = '🌶️';
    slider.parentElement.appendChild(chili);

    // Function to update chili position
    const updateChiliPosition = () => {
        const value = parseFloat(slider.value);
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const sliderWidth = slider.offsetWidth;

        // Calculate position as percentage of slider width
        // Chili uses translate(-50%) so it centers on the position
        const percent = (value - min) / (max - min);
        const position = percent * sliderWidth;

        chili.style.left = `${position}px`;
        chili.style.transform = 'translate(-50%, 50%)';
    };

    // Update display value as slider moves
    slider.addEventListener('input', (e) => {
        valueDisplay.textContent = parseFloat(e.target.value).toFixed(1);
        updateChiliPosition();
    });

    // Auto-save when slider changes
    slider.addEventListener('change', async () => {
        if (!currentRestaurant) return;
        await saveRatingToFirebase();
    });

    // Initial position - delay to ensure slider is rendered
    setTimeout(updateChiliPosition, 100);

    // Update on window resize
    window.addEventListener('resize', updateChiliPosition);
});

// Burger menu toggle
document.getElementById('burgerMenuBtn').addEventListener('click', () => {
    const menu = document.getElementById('slideOutMenu');
    const backdrop = document.getElementById('menuBackdrop');
    menu.classList.add('active');
    backdrop.classList.add('active');
});

// Close menu button
document.getElementById('closeMenuBtn').addEventListener('click', () => {
    const menu = document.getElementById('slideOutMenu');
    const backdrop = document.getElementById('menuBackdrop');
    menu.classList.remove('active');
    backdrop.classList.remove('active');
});

// Close menu when clicking backdrop
document.getElementById('menuBackdrop').addEventListener('click', () => {
    const menu = document.getElementById('slideOutMenu');
    const backdrop = document.getElementById('menuBackdrop');
    menu.classList.remove('active');
    backdrop.classList.remove('active');
});

// Menu navigation - Members
document.getElementById('menuMembersLink').addEventListener('click', (e) => {
    e.preventDefault();
    // Close menu
    document.getElementById('slideOutMenu').classList.remove('active');
    document.getElementById('menuBackdrop').classList.remove('active');
    // Navigate to members page
    showPage('members');
    loadMembersPage();
});

// Menu navigation - Profile
document.getElementById('menuProfileLink').addEventListener('click', (e) => {
    e.preventDefault();
    // Close menu
    document.getElementById('slideOutMenu').classList.remove('active');
    document.getElementById('menuBackdrop').classList.remove('active');
    // Navigate to profile page
    showPage('profile');
    loadProfilePage();
});

// Menu navigation - Logout
document.getElementById('menuLogoutLink').addEventListener('click', async (e) => {
    e.preventDefault();
    // Close menu
    document.getElementById('slideOutMenu').classList.remove('active');
    document.getElementById('menuBackdrop').classList.remove('active');
    // Logout
    try {
        await signOut(auth);
        showPage('login');
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Profile back button
document.getElementById('profileBackBtn').addEventListener('click', () => {
    showPage('dashboard');
});

// Load profile page
function loadProfilePage() {
    if (currentUser) {
        document.getElementById('profileNameInput').value = currentUser.displayName || '';
        document.getElementById('profileEmail').textContent = currentUser.email;
    }
}

// Change name form
document.getElementById('changeNameForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const newName = document.getElementById('profileNameInput').value.trim();

    if (!newName) {
        showToast('Name cannot be empty');
        return;
    }

    showLoading();
    try {
        await updateProfile(currentUser, {
            displayName: newName
        });

        hideLoading();
        showToast('Name updated successfully!');
    } catch (error) {
        hideLoading();
        console.error('Error updating name:', error);
        showToast('Error updating name: ' + error.message);
    }
});

// Change password form
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    // Validate passwords match
    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match');
        return;
    }

    // Validate password length
    if (newPassword.length < 6) {
        showToast('Password must be at least 6 characters');
        return;
    }

    showLoading();
    try {
        // Re-authenticate user
        const credential = EmailAuthProvider.credential(
            currentUser.email,
            currentPassword
        );
        await reauthenticateWithCredential(currentUser, credential);

        // Update password
        await updatePassword(currentUser, newPassword);

        hideLoading();
        showToast('Password updated successfully!');

        // Clear form
        document.getElementById('changePasswordForm').reset();
    } catch (error) {
        hideLoading();
        console.error('Error changing password:', error);

        if (error.code === 'auth/wrong-password') {
            showToast('Current password is incorrect');
        } else if (error.code === 'auth/weak-password') {
            showToast('New password is too weak');
        } else {
            showToast('Error updating password: ' + error.message);
        }
    }
});

// Menu navigation - Admin
document.getElementById('menuAdminLink').addEventListener('click', (e) => {
    e.preventDefault();

    // Check if user is admin
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Access denied - Admin only');
        return;
    }

    // Close menu
    document.getElementById('slideOutMenu').classList.remove('active');
    document.getElementById('menuBackdrop').classList.remove('active');

    // Navigate to admin page
    showPage('admin');
    loadAdminPage();
});

// Admin back button
document.getElementById('adminBackBtn').addEventListener('click', () => {
    showPage('dashboard');
});

// Load admin analytics page
async function loadAdminPage() {
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Access denied - Admin only');
        showPage('dashboard');
        return;
    }

    showLoading();
    try {
        // Load whitelist
        await loadWhitelist();

        // Load user analytics
        const sessionsSnapshot = await getDocs(collection(db, 'sessions'));
        const userAnalytics = [];

        for (const sessionDoc of sessionsSnapshot.docs) {
            const sessionData = sessionDoc.data();
            const userId = sessionDoc.id;

            // Get session history
            const historySnapshot = await getDocs(
                query(
                    collection(db, 'sessions', userId, 'history'),
                    orderBy('loginTime', 'desc')
                )
            );

            const sessions = [];
            let totalDuration = 0;

            historySnapshot.forEach(histDoc => {
                const hist = histDoc.data();
                sessions.push({
                    loginTime: hist.loginTime?.toDate() || new Date(),
                    duration: hist.duration || 0
                });
                totalDuration += hist.duration || 0;
            });

            // Get last login time
            const lastLoginTime = sessionData.loginTime?.toDate() || new Date();

            // Calculate current session duration if user is currently logged in
            let currentSessionDuration = 0;
            if (sessionData.lastActivity) {
                const lastActivity = sessionData.lastActivity.toDate();
                const now = new Date();
                const timeSinceActivity = (now - lastActivity) / 1000; // in seconds

                // Only count as active if last activity was within 5 minutes
                if (timeSinceActivity < 300) {
                    currentSessionDuration = (now - lastLoginTime) / 1000; // in seconds
                }
            }

            userAnalytics.push({
                userId,
                userName: sessionData.userName || 'Unknown',
                lastLogin: lastLoginTime,
                currentSessionDuration,
                sessions,
                totalDuration,
                averageDuration: sessions.length > 0 ? totalDuration / sessions.length : 0
            });
        }

        // Sort by last login (most recent first)
        userAnalytics.sort((a, b) => b.lastLogin - a.lastLogin);

        renderAdminTable(userAnalytics);
        hideLoading();
    } catch (error) {
        console.error('Error loading admin analytics:', error);
        showToast('Error loading analytics');
        hideLoading();
    }
}

// Render admin analytics table
function renderAdminTable(userAnalytics) {
    const tbody = document.getElementById('adminTableBody');
    tbody.innerHTML = '';

    userAnalytics.forEach((user, index) => {
        // Create user row
        const row = document.createElement('tr');
        row.dataset.userId = user.userId;
        row.dataset.expanded = 'false';

        const lastLoginStr = formatDate(user.lastLogin);
        const sessionTimeStr = formatDuration(user.currentSessionDuration);

        row.innerHTML = `
            <td>${user.userName}</td>
            <td>${lastLoginStr}</td>
            <td>${sessionTimeStr}</td>
            <td><span class="expand-icon">▶</span></td>
        `;

        // Click handler to expand/collapse drawer
        row.addEventListener('click', () => {
            const isExpanded = row.dataset.expanded === 'true';

            // Close all other drawers
            tbody.querySelectorAll('tr[data-user-id]').forEach(r => {
                if (r !== row) {
                    r.dataset.expanded = 'false';
                    const icon = r.querySelector('.expand-icon');
                    if (icon) icon.classList.remove('expanded');
                    const nextDrawer = r.nextElementSibling;
                    if (nextDrawer && nextDrawer.classList.contains('analytics-drawer-row')) {
                        nextDrawer.remove();
                    }
                }
            });

            if (!isExpanded) {
                // Expand this drawer
                row.dataset.expanded = 'true';
                row.querySelector('.expand-icon').classList.add('expanded');

                // Create drawer row
                const drawerRow = document.createElement('tr');
                drawerRow.className = 'analytics-drawer-row';
                drawerRow.innerHTML = `
                    <td colspan="4">
                        <div class="analytics-drawer">
                            <div class="analytics-grid">
                                <div class="analytics-stat">
                                    <div class="analytics-label">TOTAL SESSIONS</div>
                                    <div class="analytics-value">${user.sessions.length}</div>
                                </div>
                                <div class="analytics-stat">
                                    <div class="analytics-label">TOTAL TIME</div>
                                    <div class="analytics-value">${formatDuration(user.totalDuration)}</div>
                                </div>
                                <div class="analytics-stat">
                                    <div class="analytics-label">AVG SESSION</div>
                                    <div class="analytics-value">${formatDuration(user.averageDuration)}</div>
                                </div>
                            </div>
                            <div class="session-list">
                                <h3 style="font-size: 12px; font-weight: 600; color: #666; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">RECENT SESSIONS</h3>
                                ${renderSessionList(user.sessions)}
                            </div>
                        </div>
                    </td>
                `;

                // Insert drawer after current row
                row.after(drawerRow);
            } else {
                // Collapse drawer
                row.dataset.expanded = 'false';
                row.querySelector('.expand-icon').classList.remove('expanded');

                // Remove drawer row
                const nextRow = row.nextElementSibling;
                if (nextRow && nextRow.classList.contains('analytics-drawer-row')) {
                    nextRow.remove();
                }
            }
        });

        tbody.appendChild(row);
    });
}

// Render session list
function renderSessionList(sessions) {
    if (sessions.length === 0) {
        return '<p style="color: #999; font-size: 13px; text-align: center;">No session history</p>';
    }

    const recentSessions = sessions.slice(0, 10); // Show last 10 sessions
    return recentSessions.map(session => `
        <div class="session-item">
            <span class="session-date">${formatDate(session.loginTime)}</span>
            <span class="session-duration">${formatDuration(session.duration)}</span>
        </div>
    `).join('');
}

// Format date helper
function formatDate(date) {
    if (!date) return 'Never';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format duration helper
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0m';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Create User Account (Admin only)
document.getElementById('createAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Access denied - Admin only');
        return;
    }

    const email = document.getElementById('accountEmail').value.trim();
    const name = document.getElementById('accountName').value.trim();
    const password = document.getElementById('accountPassword').value;

    if (!email || !name || !password) {
        showToast('All fields are required');
        return;
    }

    showLoading();
    try {
        // Create the user account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Set display name
        await updateProfile(userCredential.user, { displayName: name });

        // Sign the admin back in (creating account logs you in as that user)
        await signOut(auth);

        hideLoading();
        showToast('Account created! Logging you back in...');

        // Wait a moment then log admin back in
        setTimeout(async () => {
            // Admin will need to log back in manually - this is a Firebase limitation
            showPage('login');
            showToast('Please log back in with your admin account');
        }, 1500);

        // Clear form
        document.getElementById('createAccountForm').reset();

    } catch (error) {
        hideLoading();
        console.error('Error creating account:', error);

        if (error.code === 'auth/email-already-in-use') {
            showToast('Email already exists');
        } else if (error.code === 'auth/weak-password') {
            showToast('Password must be at least 6 characters');
        } else {
            showToast('Error creating account: ' + error.message);
        }
    }
});

// Whitelist Management
async function loadWhitelist() {
    try {
        const whitelistSnapshot = await getDocs(collection(db, 'whitelist'));
        const tableBody = document.getElementById('whitelistTableBody');

        if (whitelistSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #999; font-size: 14px; font-style: italic;">No whitelisted emails yet</td></tr>';
            return;
        }

        tableBody.innerHTML = '';

        // Get all user accounts to match emails with names
        const usersSnapshot = await getDocs(collection(db, 'sessions'));
        const userNameMap = {};
        usersSnapshot.forEach(userDoc => {
            const userData = userDoc.data();
            if (userData.userName) {
                // Try to match by userId, but we need email
                userNameMap[userDoc.id] = userData.userName;
            }
        });

        whitelistSnapshot.forEach(whitelistDoc => {
            const email = whitelistDoc.id;
            const data = whitelistDoc.data();

            // Try to find name from sessions, otherwise use email prefix
            let name = email.split('@')[0];

            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="word-break: break-word; max-width: 150px;">${name}</td>
                <td style="word-break: break-word; max-width: 200px;">${email}</td>
                <td style="text-align: right;">
                    <button
                        class="whitelist-remove-btn"
                        data-email="${email}"
                        style="background: transparent; border: none; color: #dc3545; font-size: 20px; cursor: pointer; padding: 4px 8px; line-height: 1;"
                    >×</button>
                </td>
            `;

            // Add remove handler
            row.querySelector('.whitelist-remove-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                const emailToRemove = e.target.dataset.email;

                if (confirm(`Remove ${emailToRemove} from whitelist?`)) {
                    try {
                        await deleteDoc(doc(db, 'whitelist', emailToRemove));
                        showToast('Email removed from whitelist');
                        await loadWhitelist();
                    } catch (error) {
                        console.error('Error removing from whitelist:', error);
                        showToast('Error removing email');
                    }
                }
            });

            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading whitelist:', error);
        showToast('Error loading whitelist');
    }
}

// Add email to whitelist - form removed from UI, whitelist now managed via CREATE USER ACCOUNT
// document.getElementById('addWhitelistForm')?.addEventListener('submit', async (e) => {
//     e.preventDefault();

//     if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
//         showToast('Access denied - Admin only');
//         return;
//     }

//     const email = document.getElementById('whitelistEmail').value.trim().toLowerCase();

//     if (!email) return;

//     showLoading();
//     try {
//         // Add to whitelist collection
//         await setDoc(doc(db, 'whitelist', email), {
//             addedBy: currentUser.email,
//             addedAt: serverTimestamp()
//         });

//         showToast('Email added to whitelist');
//         document.getElementById('whitelistEmail').value = '';
//         await loadWhitelist();
//         hideLoading();
//     } catch (error) {
//         hideLoading();
//         console.error('Error adding to whitelist:', error);
//         showToast('Error adding email');
//     }
// });

// Initialize
console.log('Beachlands Curry Club initialized');
