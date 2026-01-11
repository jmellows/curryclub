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
let isCreatingAccount = false; // Flag to skip session tracking during account creation

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

        // Track session (skip if we're creating an account)
        if (!isCreatingAccount) {
            trackUserSession(user);
        }

        // Listen for notifications
        setupNotificationListener();

        // Setup notification dropdown
        setupNotificationDropdown();
        renderNotifications();
        updateNotificationBadge();

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
        await loadNextEvent();
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
        // Prevent concurrent listener executions
        if (isLoadingRestaurants) {
            console.log('⏭️ Skipping listener callback - already loading');
            return;
        }
        isLoadingRestaurants = true;

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
        await loadNextEvent();

        isLoadingRestaurants = false;
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

// Load next event
let countdownInterval = null;
async function loadNextEvent() {
    try {
        console.log('📅 Loading Next Event...');
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        if (pickDoc.exists() && pickDoc.data().restaurantId) {
            const restaurantId = pickDoc.data().restaurantId;
            console.log('📅 Found tonightsPick restaurantId:', restaurantId);

            // Fetch restaurant directly from Firestore (don't use filtered allRestaurants)
            const restaurantDoc = await getDoc(doc(db, 'restaurants', restaurantId));
            if (!restaurantDoc.exists()) {
                console.log('📅 Restaurant not found in DB');
                document.getElementById('nextEventSection').classList.add('hidden');
                return;
            }

            const restaurantData = restaurantDoc.data();
            console.log('📅 Restaurant data:', restaurantData);

            // Get rating count
            const ratingsSnapshot = await getDocs(collection(db, 'restaurants', restaurantId, 'ratings'));
            const ratingCount = ratingsSnapshot.size;
            console.log('📅 Rating count:', ratingCount);

            // Build restaurant object
            const restaurant = {
                id: restaurantId,
                ...restaurantData,
                ratingCount,
                averageRatings: {
                    overall: 0,
                    meal: 0,
                    bathroom: 0,
                    ambiance: 0,
                    service: 0
                }
            };

            console.log('📅 Checking conditions - eventDate:', restaurant.eventDate, 'ratingCount:', restaurant.ratingCount);

            // Show locked events regardless of date - they disappear when someone rates
            if (restaurant.eventDate && restaurant.ratingCount === 0) {
                console.log('📅 Showing Next Event (locked, no ratings yet)');

                // Convert Firestore timestamp to Date
                const eventDate = restaurant.eventDate.toDate ? restaurant.eventDate.toDate() : new Date(restaurant.eventDate);
                const now = new Date();

                document.getElementById('nextEventSection').classList.remove('hidden');
                document.getElementById('nextEventName').textContent = restaurant.name;
                document.getElementById('nextEventRating').textContent =
                    `${restaurant.averageRatings.overall.toFixed(1)}/10`;

                // Show hosted by if provided
                const hostedByEl = document.getElementById('nextEventHostedBy');
                if (restaurant.hostedBy) {
                    hostedByEl.textContent = `Hosted by ${restaurant.hostedBy}`;
                    hostedByEl.style.display = 'block';
                } else {
                    hostedByEl.style.display = 'none';
                }

                // Show formatted date
                const dateEl = document.getElementById('nextEventDate');
                const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                const formattedDate = eventDate.toLocaleDateString('en-US', options);
                const formattedTime = restaurant.eventTime || eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                dateEl.textContent = `${formattedDate} at ${formattedTime}`;

                // Show address if provided
                const addressEl = document.getElementById('nextEventAddress');
                if (restaurant.eventAddress) {
                    addressEl.textContent = `📍 ${restaurant.eventAddress}`;
                    addressEl.style.display = 'block';
                } else {
                    addressEl.style.display = 'none';
                }

                // Check if restaurant is locked
                const isLocked = restaurant.isLocked || false;
                const lockIcon = document.getElementById('nextEventLock');
                const rateButton = document.getElementById('rateNextEvent');

                if (isLocked) {
                    lockIcon.textContent = '🔒';
                    rateButton.style.display = 'none';
                } else {
                    lockIcon.textContent = '🔓';
                    rateButton.style.display = 'inline-block';
                }

                // Start countdown timer
                if (countdownInterval) clearInterval(countdownInterval);

                const updateCountdown = () => {
                    const now = new Date();
                    const diff = eventDate - now;

                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

                    const countdownElement = document.getElementById('nextEventCountdown');
                    let countdownText = '';

                    if (diff > 0) {
                        // Future event
                        countdownElement.classList.remove('live');
                        if (days > 0) {
                            countdownText = `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''} until event`;
                        } else if (hours > 0) {
                            countdownText = `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''} until event`;
                        } else {
                            countdownText = `${minutes} minute${minutes !== 1 ? 's' : ''}, ${seconds} second${seconds !== 1 ? 's' : ''} until event`;
                        }
                    } else {
                        // Event has started
                        countdownElement.classList.add('live');
                        countdownText = `LIVE EVENT`;
                    }

                    document.querySelector('#nextEventCountdown .countdown-display').textContent = countdownText;
                };

                updateCountdown();
                countdownInterval = setInterval(updateCountdown, 1000);

                // Make entire Next Event card clickable
                document.getElementById('nextEventCard').onclick = () => showRestaurantDetail(restaurant);
                document.getElementById('rateNextEvent').onclick = () => showRestaurantDetail(restaurant);

                // Setup RSVP functionality
                await setupRSVPForNextEvent();
            } else {
                console.log('📅 No eventDate or ratingCount > 0 - hiding');
                document.getElementById('nextEventSection').classList.add('hidden');
            }
        } else {
            console.log('📅 No tonightsPick set - hiding');
            document.getElementById('nextEventSection').classList.add('hidden');
        }
    } catch (error) {
        console.error('📅 Error loading next event:', error);
    }
}

// Show restaurant detail
async function showRestaurantDetail(restaurant) {
    currentRestaurant = restaurant;

    // Set basic info immediately
    document.getElementById('detailRestaurantName').textContent = restaurant.name;

    // Show hosted by if provided
    const detailHostedBy = document.getElementById('detailHostedBy');
    if (restaurant.hostedBy) {
        detailHostedBy.textContent = `Hosted by ${restaurant.hostedBy}`;
        detailHostedBy.style.display = 'block';
    } else {
        detailHostedBy.style.display = 'none';
    }

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
    document.getElementById('overallAverageValue').textContent = '0.0/10';


    // Show/hide admin buttons for admin only
    const deleteBtn = document.getElementById('deleteRestaurantBtn');
    const lockBtn = document.getElementById('lockRestaurantBtn');
    const starBtn = document.getElementById('setNextEvent');
    const closeEventBtn = document.getElementById('closeEventBtn');

    if (currentUser && currentUser.email === ADMIN_EMAIL) {
        deleteBtn.classList.remove('hidden');
        lockBtn.classList.remove('hidden');
        starBtn.classList.remove('hidden');
    } else {
        deleteBtn.classList.add('hidden');
        lockBtn.classList.add('hidden');
        starBtn.classList.add('hidden');
    }

    // Show/hide Close Event button for events (any user can close)
    const isEventClosed = restaurant.eventClosed || false;
    if (restaurant.isLocked && restaurant.eventDate) {
        closeEventBtn.classList.remove('hidden');
        if (isEventClosed) {
            closeEventBtn.classList.add('closed');
            closeEventBtn.title = 'Event Closed';
        } else {
            closeEventBtn.classList.remove('closed');
            closeEventBtn.title = 'Close Event';
        }
    } else {
        closeEventBtn.classList.add('hidden');
    }

    // Check if restaurant is locked and disable sliders
    const isLocked = restaurant.isLocked || false;
    const sliders = ['mealSlider', 'bathroomSlider', 'ambianceSlider', 'serviceSlider'];

    sliders.forEach(sliderId => {
        const slider = document.getElementById(sliderId);
        // Disable sliders if event is closed OR if locked and not admin
        if (isEventClosed || (isLocked && currentUser.email !== ADMIN_EMAIL)) {
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

    // Show/hide event details section for locked restaurants with event data
    const eventDetailsSection = document.getElementById('eventDetailsSection');
    const detailContainer = document.querySelector('.detail-container');
    const overallAverageDisplay = document.getElementById('overallAverageDisplay');

    if (isLocked && restaurant.eventDate) {
        const eventDate = restaurant.eventDate.toDate ? restaurant.eventDate.toDate() : new Date(restaurant.eventDate);
        const now = new Date();

        // Only show event details if event hasn't started yet
        if (now < eventDate) {
            // Event upcoming - show event details
            document.getElementById('editEventDate').value = eventDate.toISOString().split('T')[0];
            document.getElementById('editEventTime').value = restaurant.eventTime || '';
            document.getElementById('editEventAddress').value = restaurant.eventAddress || '';

            // Load member names and set the current hosted by value
            await loadMemberNames('editHostedBy');
            document.getElementById('editHostedBy').value = restaurant.hostedBy || '';

            eventDetailsSection.classList.remove('hidden');

            // Add locked styling if user is not admin
            if (currentUser.email !== ADMIN_EMAIL) {
                detailContainer.classList.add('locked');
                overallAverageDisplay.classList.add('locked');
            } else {
                detailContainer.classList.remove('locked');
                overallAverageDisplay.classList.remove('locked');
            }
        } else {
            // Event has started - hide event details
            eventDetailsSection.classList.add('hidden');
            detailContainer.classList.remove('locked');
            overallAverageDisplay.classList.remove('locked');
        }
    } else {
        eventDetailsSection.classList.add('hidden');
        detailContainer.classList.remove('locked');
        overallAverageDisplay.classList.remove('locked');
    }

    // FLIP TO DETAIL PAGE IMMEDIATELY
    showPage('detail');

    // Setup mark attendance (check if event has started and user RSVP'd)
    await setupMarkAttendance(restaurant);

    // Load and display rating report if one exists
    await loadRatingReport(restaurant.id);

    // Load data in background while flip animation plays
    // Check if this is next event
    getDoc(doc(db, 'tonightsPick', 'current')).then(pickDoc => {
        const isNextEvent = pickDoc.exists() && pickDoc.data().restaurantId === restaurant.id;

        const toggleBtn = document.getElementById('setNextEvent');
        const submitBtn = document.getElementById('submitRating');

        if (isNextEvent) {
            toggleBtn.classList.add('active');
            toggleBtn.textContent = '⭐';

            // Show submit button only if event has started AND event is not closed
            if (restaurant.eventDate && !restaurant.eventClosed) {
                const eventDate = restaurant.eventDate.toDate ? restaurant.eventDate.toDate() : new Date(restaurant.eventDate);
                const now = new Date();

                // Only show submit button if event has started
                if (now >= eventDate) {
                    submitBtn.classList.add('show-for-next-event');
                } else {
                    submitBtn.classList.remove('show-for-next-event');
                }
            } else {
                submitBtn.classList.remove('show-for-next-event');
            }
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = '☆';
            // Hide submit button for other restaurants
            submitBtn.classList.remove('show-for-next-event');
        }
    }).catch(error => {
        console.error('Error checking next event:', error);
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

            // Check if this is Next Event and disable submit button if user already rated
            getDoc(doc(db, 'tonightsPick', 'current')).then(pickDoc => {
                const isNextEvent = pickDoc.exists() && pickDoc.data().restaurantId === restaurant.id;
                if (isNextEvent && restaurant.eventDate) {
                    const eventDate = restaurant.eventDate.toDate ? restaurant.eventDate.toDate() : new Date(restaurant.eventDate);
                    const now = new Date();

                    // Only disable button if event has started (otherwise button is hidden anyway)
                    if (now >= eventDate) {
                        const submitBtn = document.getElementById('submitRating');
                        submitBtn.disabled = true;
                        submitBtn.classList.add('submitted');
                        submitBtn.textContent = 'RATING SUBMITTED';
                    }
                }
            });

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

                document.getElementById('overallAverageValue').textContent = 'locked';
            } else {
                document.getElementById('overallAverageValue').textContent = '0.0/10';
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


// Set/remove next event
document.getElementById('setNextEvent').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    try {
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        const isNextEvent = pickDoc.exists() && pickDoc.data().restaurantId === currentRestaurant.id;

        if (isNextEvent) {
            // Remove from next event
            await setDoc(doc(db, 'tonightsPick', 'current'), { restaurantId: null });
            showToast('Removed from Next Event');

            document.getElementById('setNextEvent').classList.remove('active');
            document.getElementById('setNextEvent').textContent = '☆';
        } else {
            // Set as next event
            await setDoc(doc(db, 'tonightsPick', 'current'), {
                restaurantId: currentRestaurant.id,
                setBy: currentUser.uid,
                setAt: serverTimestamp()
            });
            showToast('Set as Next Event!');

            document.getElementById('setNextEvent').classList.add('active');
            document.getElementById('setNextEvent').textContent = '⭐';
        }

        await loadNextEvent();
    } catch (error) {
        console.error('Error toggling next event:', error);
        showToast('Error updating Next Event');
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
        const detailContainer = document.querySelector('.detail-container');
        const overallAverageDisplay = document.getElementById('overallAverageDisplay');
        const eventDetailsSection = document.getElementById('eventDetailsSection');

        if (newLockStatus) {
            lockBtn.textContent = '🔒';
            lockBtn.classList.add('locked');
            showToast(`${currentRestaurant.name} is now locked - users cannot rate`);

            // Show event details if restaurant has event data AND event hasn't started
            if (currentRestaurant.eventDate) {
                const eventDate = currentRestaurant.eventDate.toDate ? currentRestaurant.eventDate.toDate() : new Date(currentRestaurant.eventDate);
                const now = new Date();

                if (now < eventDate) {
                    // Event upcoming - show event details
                    eventDetailsSection.classList.remove('hidden');
                    document.getElementById('editEventDate').value = eventDate.toISOString().split('T')[0];
                    document.getElementById('editEventTime').value = currentRestaurant.eventTime || '';
                    document.getElementById('editEventAddress').value = currentRestaurant.eventAddress || '';

                    // Load member names and set the current hosted by value
                    await loadMemberNames('editHostedBy');
                    document.getElementById('editHostedBy').value = currentRestaurant.hostedBy || '';

                    // Add locked styling if user is not admin
                    if (currentUser.email !== ADMIN_EMAIL) {
                        detailContainer.classList.add('locked');
                        overallAverageDisplay.classList.add('locked');
                        document.getElementById('overallAverageValue').textContent = 'locked';
                    } else {
                        detailContainer.classList.remove('locked');
                        overallAverageDisplay.classList.remove('locked');
                    }
                } else {
                    // Event has started - hide event details
                    eventDetailsSection.classList.add('hidden');
                    detailContainer.classList.remove('locked');
                    overallAverageDisplay.classList.remove('locked');
                }
            }
        } else {
            lockBtn.textContent = '🔓';
            lockBtn.classList.remove('locked');
            showToast(`${currentRestaurant.name} is now unlocked - users can rate`);

            // Hide event details and remove locked styling
            eventDetailsSection.classList.add('hidden');
            detailContainer.classList.remove('locked');
            overallAverageDisplay.classList.remove('locked');

            // Reset overall average text
            if (currentUserRating) {
                const overallAvg = ((currentUserRating.meal + currentUserRating.bathroom + currentUserRating.ambiance + currentUserRating.service) / 4).toFixed(1);
                document.getElementById('overallAverageValue').textContent = `${overallAvg}/10`;
            } else {
                document.getElementById('overallAverageValue').textContent = '0.0/10';
            }
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

// Save event details
document.getElementById('saveEventDetails').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    const eventDate = document.getElementById('editEventDate').value;
    const eventTime = document.getElementById('editEventTime').value;
    const eventAddress = document.getElementById('editEventAddress').value.trim();
    const hostedBy = document.getElementById('editHostedBy').value.trim();

    if (!eventDate || !eventTime) {
        showToast('Date and time are required');
        return;
    }

    // Combine date and time into a single timestamp
    const eventDateTime = new Date(`${eventDate}T${eventTime}`);

    showLoading();
    try {
        await updateDoc(doc(db, 'restaurants', currentRestaurant.id), {
            eventDate: eventDateTime,
            eventTime: eventTime,
            eventAddress: eventAddress || '',
            hostedBy: hostedBy || ''
        });

        // Update current restaurant object
        currentRestaurant.eventDate = eventDateTime;
        currentRestaurant.eventTime = eventTime;
        currentRestaurant.eventAddress = eventAddress || '';
        currentRestaurant.hostedBy = hostedBy || '';

        hideLoading();
        showToast('Event details updated!');

        // Refresh Next Event display
        await loadNextEvent();
    } catch (error) {
        hideLoading();
        console.error('Error saving event details:', error);
        showToast('Error updating event details');
    }
});

// Close Event (any user can close)
document.getElementById('closeEventBtn').addEventListener('click', async () => {
    if (!currentRestaurant) return;
    if (!currentUser) {
        showToast('You must be logged in to close an event');
        return;
    }

    // Check if already closed
    if (currentRestaurant.eventClosed) {
        showToast('Event is already closed');
        return;
    }

    const confirmed = await showConfirmModal(
        'Close Event',
        `Close the event for "${currentRestaurant.name}"? This will lock all ratings and hide the submit button.`
    );

    if (!confirmed) {
        return;
    }

    try {
        await updateDoc(doc(db, 'restaurants', currentRestaurant.id), {
            eventClosed: true
        });

        showToast('Event closed!');

        // Update current restaurant object
        currentRestaurant.eventClosed = true;

        // Update UI
        const closeEventBtn = document.getElementById('closeEventBtn');
        closeEventBtn.classList.add('closed');
        closeEventBtn.title = 'Event Closed';

        // Hide submit button
        const submitBtn = document.getElementById('submitRating');
        submitBtn.classList.remove('show-for-next-event');

        // Make sliders read-only
        const sliders = ['mealSlider', 'bathroomSlider', 'ambianceSlider', 'serviceSlider'];
        sliders.forEach(sliderId => {
            document.getElementById(sliderId).disabled = true;
        });

    } catch (error) {
        console.error('Error closing event:', error);
        showToast('Error closing event');
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

        showToast('Rating saved!');

        // Check if this triggers a rating report generation
        await checkAndGenerateRatingReport(currentRestaurant.id);
    } catch (error) {
        console.error('Error saving rating:', error);
        showToast('Error saving rating');
    }
}

// Submit rating
document.getElementById('submitRating').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    const submitBtn = document.getElementById('submitRating');

    // Check if already submitted
    if (submitBtn.classList.contains('submitted') || submitBtn.disabled) {
        return;
    }

    await saveRatingToFirebase();

    // Disable button and change appearance
    submitBtn.disabled = true;
    submitBtn.classList.add('submitted');
    submitBtn.textContent = 'RATING SUBMITTED';
});

// Load member names for hosted by dropdown
async function loadMemberNames(selectElementId) {
    const selectElement = document.getElementById(selectElementId);
    if (!selectElement) return;

    try {
        // Get all sessions to find member names
        const sessionsSnapshot = await getDocs(collection(db, 'sessions'));
        const members = new Set();

        sessionsSnapshot.forEach(sessionDoc => {
            const sessionData = sessionDoc.data();
            if (sessionData.userName) {
                members.add(sessionData.userName);
            }
        });

        // Sort member names alphabetically
        const sortedMembers = Array.from(members).sort();

        // Keep the current selection if exists
        const currentValue = selectElement.value;

        // Clear existing options except the first one
        selectElement.innerHTML = '<option value="">Select a member...</option>';

        // Add member names as options
        sortedMembers.forEach(memberName => {
            const option = document.createElement('option');
            option.value = memberName;
            option.textContent = memberName;
            selectElement.appendChild(option);
        });

        // Restore selection if it existed
        if (currentValue) {
            selectElement.value = currentValue;
        }
    } catch (error) {
        console.error('Error loading member names:', error);
    }
}

// Add restaurant modal
document.getElementById('addRestaurantBtn').addEventListener('click', async () => {
    document.getElementById('addRestaurantModal').classList.add('active');
    document.getElementById('addRestaurantForm').reset();

    // Load member names for the dropdown
    await loadMemberNames('hostedBy');
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
    const eventDate = document.getElementById('eventDate').value;
    const eventTime = document.getElementById('eventTime').value;
    const eventAddress = document.getElementById('eventAddress').value.trim();
    const hostedBy = document.getElementById('hostedBy').value.trim();

    if (!name || !eventDate || !eventTime) {
        showToast('Please fill in all required fields');
        isSubmittingRestaurant = false;
        return;
    }

    // Combine date and time into a single timestamp
    const eventDateTime = new Date(`${eventDate}T${eventTime}`);

    showLoading();
    try {
        // Add restaurant (auto-locked)
        const restaurantRef = await addDoc(collection(db, 'restaurants'), {
            name,
            eventDate: eventDateTime,
            eventTime: eventTime,
            eventAddress: eventAddress || '',
            hostedBy: hostedBy || '',
            isLocked: true, // Auto-locked for new restaurants
            createdBy: currentUser.uid,
            createdAt: serverTimestamp()
        });

        // Automatically set as Next Event (tonightsPick)
        await setDoc(doc(db, 'tonightsPick', 'current'), {
            restaurantId: restaurantRef.id,
            setBy: currentUser.uid,
            setAt: serverTimestamp()
        });

        // Reload to show Next Event
        await loadNextEvent();

        hideLoading();
        document.getElementById('addRestaurantModal').classList.remove('active');
        document.getElementById('addRestaurantForm').reset();
        showToast('Event created! Restaurant is locked until ready for ratings.');
    } catch (error) {
        hideLoading();
        console.error('Error adding restaurant:', error);
        showToast('Error creating event');
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

    // Auto-save when slider changes (only for non-Next Event restaurants)
    slider.addEventListener('change', async () => {
        if (!currentRestaurant) return;

        // Check if this is the Next Event
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        const isNextEvent = pickDoc.exists() && pickDoc.data().restaurantId === currentRestaurant.id;

        // Only auto-save if NOT the Next Event (Next Event requires submit button)
        if (!isNextEvent) {
            await saveRatingToFirebase();
        }
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

// Menu navigation - Feature Request
document.getElementById('menuFeatureRequestLink').addEventListener('click', async (e) => {
    e.preventDefault();
    // Close menu
    document.getElementById('slideOutMenu').classList.remove('active');
    document.getElementById('menuBackdrop').classList.remove('active');

    // Load member names and auto-select current user
    await loadMemberNames('featureRequestMember');
    if (currentUser && currentUser.displayName) {
        document.getElementById('featureRequestMember').value = currentUser.displayName;
    }

    showPage('featureRequest');
});

// Feature Request back button
document.getElementById('featureRequestBackBtn').addEventListener('click', () => {
    showPage('dashboard');
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

// Feature Request form submission
document.getElementById('featureRequestForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser) {
        showToast('You must be logged in to submit a feature request');
        return;
    }

    const memberName = document.getElementById('featureRequestMember').value.trim();
    const title = document.getElementById('featureRequestTitle').value.trim();
    const description = document.getElementById('featureRequestDescription').value.trim();

    if (!memberName || !title || !description) {
        showToast('Please fill in all fields');
        return;
    }

    showLoading();
    try {
        await addDoc(collection(db, 'featureRequests'), {
            memberName,
            title,
            description,
            submittedBy: currentUser.uid,
            submittedAt: serverTimestamp()
        });

        hideLoading();
        showToast('Feature request submitted!');

        // Clear form
        document.getElementById('featureRequestForm').reset();

        // Navigate back to dashboard
        showPage('dashboard');
    } catch (error) {
        hideLoading();
        console.error('Error submitting feature request:', error);
        showToast('Error submitting request');
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

        // Load feature requests
        await loadFeatureRequests();

        // Load delete rating dropdowns
        await loadDeleteRatingDropdowns();

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

// Load feature requests for admin panel
async function loadFeatureRequests() {
    try {
        const featureRequestsSnapshot = await getDocs(collection(db, 'featureRequests'));
        const featureRequests = [];

        featureRequestsSnapshot.forEach(doc => {
            featureRequests.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Sort by newest first
        featureRequests.sort((a, b) => {
            const aTime = a.submittedAt?.toDate?.() || new Date(0);
            const bTime = b.submittedAt?.toDate?.() || new Date(0);
            return bTime - aTime;
        });

        renderFeatureRequestsTable(featureRequests);
    } catch (error) {
        console.error('Error loading feature requests:', error);
    }
}

// Render feature requests table
function renderFeatureRequestsTable(featureRequests) {
    const tbody = document.getElementById('featureRequestsTableBody');
    tbody.innerHTML = '';

    if (featureRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #999; font-size: 14px; font-style: italic;">No feature requests yet</td></tr>';
        return;
    }

    featureRequests.forEach((request) => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.dataset.expanded = 'false';
        row.dataset.requestId = request.id;

        const submittedDate = request.submittedAt?.toDate?.() || new Date();
        const dateStr = formatDate(submittedDate);

        row.innerHTML = `
            <td style="font-weight: 600;">${request.title}</td>
            <td>${request.memberName}</td>
            <td>${dateStr}</td>
            <td style="text-align: right;">
                <button
                    class="feature-request-delete-btn"
                    data-request-id="${request.id}"
                    style="background: transparent; border: none; color: #dc3545; font-size: 20px; cursor: pointer; padding: 4px 8px; line-height: 1;"
                >×</button>
            </td>
        `;

        // Add click handler to expand/collapse
        row.addEventListener('click', (e) => {
            // Don't expand if clicking delete button
            if (e.target.classList.contains('feature-request-delete-btn')) return;

            const isExpanded = row.dataset.expanded === 'true';
            const existingDetailRow = row.nextElementSibling;

            if (isExpanded) {
                // Collapse
                if (existingDetailRow && existingDetailRow.classList.contains('feature-detail-row')) {
                    existingDetailRow.remove();
                }
                row.dataset.expanded = 'false';
            } else {
                // Expand
                const detailRow = document.createElement('tr');
                detailRow.classList.add('feature-detail-row');
                detailRow.innerHTML = `
                    <td colspan="4" style="background: #faf8f3; padding: 20px; border-left: 4px solid #ff6b35;">
                        <div style="margin-bottom: 12px;">
                            <strong style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Description:</strong>
                        </div>
                        <div style="color: #333; line-height: 1.6; white-space: pre-wrap;">${request.description}</div>
                    </td>
                `;
                row.after(detailRow);
                row.dataset.expanded = 'true';
            }
        });

        // Add delete button handler
        row.querySelector('.feature-request-delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            const requestId = e.target.dataset.requestId;

            if (confirm('Delete this feature request?')) {
                try {
                    await deleteDoc(doc(db, 'featureRequests', requestId));
                    showToast('Feature request deleted');
                    await loadFeatureRequests();
                } catch (error) {
                    console.error('Error deleting feature request:', error);
                    showToast('Error deleting request');
                }
            }
        });

        tbody.appendChild(row);
    });
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
        // Set flag to skip session tracking during account creation
        isCreatingAccount = true;

        // Create the user account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Set display name
        await updateProfile(userCredential.user, { displayName: name });

        // Sign the admin back in (creating account logs you in as that user)
        await signOut(auth);

        // Reset flag
        isCreatingAccount = false;

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
        // Reset flag on error
        isCreatingAccount = false;

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

// Admin Notification Sender
document.getElementById('sendNotificationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Access denied - Admin only');
        return;
    }

    const message = document.getElementById('notificationMessage').value.trim();

    if (!message) {
        showToast('Message is required');
        return;
    }

    showLoading();
    try {
        await addDoc(collection(db, 'notifications'), {
            message: message,
            type: 'admin_broadcast',
            sentBy: currentUser.displayName || currentUser.email,
            timestamp: serverTimestamp()
        });

        hideLoading();
        showToast('Notification sent to all users!');

        // Clear form
        document.getElementById('sendNotificationForm').reset();
    } catch (error) {
        hideLoading();
        console.error('Error sending notification:', error);
        showToast('Error sending notification');
    }
});

// ==================== NOTIFICATION BELL ====================

// Notification bell toggle
document.getElementById('notificationBellBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');
    dropdown.classList.toggle('hidden');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notificationDropdown');
    const bell = document.getElementById('notificationBellBtn');
    if (!dropdown.contains(e.target) && !bell.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

// Mark all notifications as read
document.getElementById('markAllReadBtn').addEventListener('click', () => {
    const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '[]');
    const allNotificationIds = Array.from(document.querySelectorAll('.notification-item')).map(item => item.dataset.notificationId);

    allNotificationIds.forEach(id => {
        if (!readNotifications.includes(id)) {
            readNotifications.push(id);
        }
    });

    localStorage.setItem('readNotifications', JSON.stringify(readNotifications));
    updateNotificationBadge();
    renderNotifications();
});

// Load and render notifications
let unsubscribeNotificationsDropdown = null;

function setupNotificationDropdown() {
    if (unsubscribeNotificationsDropdown) {
        unsubscribeNotificationsDropdown();
    }

    const notificationsQuery = query(
        collection(db, 'notifications'),
        orderBy('timestamp', 'desc')
    );

    unsubscribeNotificationsDropdown = onSnapshot(notificationsQuery, (snapshot) => {
        renderNotifications();
    });
}

async function renderNotifications() {
    const notificationList = document.getElementById('notificationList');
    const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '[]');

    try {
        const notificationsSnapshot = await getDocs(
            query(collection(db, 'notifications'), orderBy('timestamp', 'desc'))
        );

        if (notificationsSnapshot.empty) {
            notificationList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No notifications yet</div>';
            updateNotificationBadge();
            return;
        }

        const notifications = [];
        notificationsSnapshot.forEach(doc => {
            notifications.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Show only last 20 notifications
        const recentNotifications = notifications.slice(0, 20);

        notificationList.innerHTML = recentNotifications.map(notification => {
            const isRead = readNotifications.includes(notification.id);
            const timestamp = notification.timestamp?.toDate();
            const timeAgo = timestamp ? formatDate(timestamp) : 'Just now';
            const restaurantId = notification.restaurantId || '';

            return `
                <div class="notification-item ${isRead ? '' : 'unread'}"
                     data-notification-id="${notification.id}"
                     data-restaurant-id="${restaurantId}"
                     style="${restaurantId ? 'cursor: pointer;' : ''}">
                    <div class="notification-title">${notification.message}</div>
                    <div class="notification-time">${timeAgo}</div>
                </div>
            `;
        }).join('');

        // Mark notification as read when clicked and navigate if has restaurantId
        document.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', async () => {
                const notificationId = item.dataset.notificationId;
                const restaurantId = item.dataset.restaurantId;
                const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '[]');

                // Mark as read
                if (!readNotifications.includes(notificationId)) {
                    readNotifications.push(notificationId);
                    localStorage.setItem('readNotifications', JSON.stringify(readNotifications));
                    updateNotificationBadge();
                    item.classList.remove('unread');
                }

                // Navigate to restaurant if has restaurantId
                if (restaurantId) {
                    // Close notification dropdown
                    document.getElementById('notificationDropdown').classList.add('hidden');

                    // Load and show restaurant detail
                    try {
                        const restaurantDoc = await getDoc(doc(db, 'restaurants', restaurantId));
                        if (restaurantDoc.exists()) {
                            const restaurantData = restaurantDoc.data();
                            const restaurant = {
                                id: restaurantDoc.id,
                                ...restaurantData,
                                // Ensure averageRatings exists
                                averageRatings: restaurantData.averageRatings || {
                                    meal: 0,
                                    bathroom: 0,
                                    ambiance: 0,
                                    service: 0
                                }
                            };
                            showRestaurantDetail(restaurant);
                        }
                    } catch (error) {
                        console.error('Error loading restaurant from notification:', error);
                        showToast('Could not load restaurant');
                    }
                }
            });
        });

        updateNotificationBadge();
    } catch (error) {
        console.error('Error loading notifications:', error);
        notificationList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Error loading notifications</div>';
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '[]');

    getDocs(query(collection(db, 'notifications'), orderBy('timestamp', 'desc')))
        .then(snapshot => {
            const unreadCount = snapshot.docs.filter(doc => !readNotifications.includes(doc.id)).length;

            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        })
        .catch(error => {
            console.error('Error updating badge:', error);
        });
}

// ==================== RSVP FUNCTIONALITY ====================

let currentEventId = null;

async function setupRSVPForNextEvent() {
    try {
        const pickDoc = await getDoc(doc(db, 'tonightsPick', 'current'));
        if (!pickDoc.exists() || !pickDoc.data().restaurantId) {
            document.getElementById('rsvpSection').classList.add('hidden');
            return;
        }

        currentEventId = pickDoc.data().restaurantId;

        // Check if user has RSVP'd
        const attendeeDoc = await getDoc(doc(db, 'eventAttendees', currentEventId, 'attendees', currentUser.uid));
        const hasRSVPd = attendeeDoc.exists();

        // Update RSVP button
        const rsvpBtn = document.getElementById('rsvpBtn');
        if (hasRSVPd) {
            rsvpBtn.textContent = 'CANCEL RSVP';
            rsvpBtn.classList.add('rsvped');
        } else {
            rsvpBtn.textContent = 'RSVP';
            rsvpBtn.classList.remove('rsvped');
        }

        // Load attendee list
        await loadAttendeeList(currentEventId);

        document.getElementById('rsvpSection').classList.remove('hidden');
    } catch (error) {
        console.error('Error setting up RSVP:', error);
    }
}

async function loadAttendeeList(eventId) {
    try {
        const attendeesSnapshot = await getDocs(collection(db, 'eventAttendees', eventId, 'attendees'));
        const attendees = [];

        attendeesSnapshot.forEach(doc => {
            attendees.push({
                id: doc.id,
                ...doc.data()
            });
        });

        const attendeeCount = document.getElementById('attendeeCount');
        const attendeeNames = document.getElementById('attendeeNames');

        attendeeCount.textContent = `${attendees.length} attending`;

        if (attendees.length > 0) {
            const names = attendees.map(a => a.userName).join(', ');
            attendeeNames.textContent = names;
            attendeeNames.style.display = 'block';
        } else {
            attendeeNames.textContent = '';
            attendeeNames.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading attendees:', error);
    }
}

// RSVP button click handler
document.getElementById('rsvpBtn').addEventListener('click', async (e) => {
    e.stopPropagation();

    if (!currentEventId) {
        showToast('No event selected');
        return;
    }

    try {
        const attendeeDoc = await getDoc(doc(db, 'eventAttendees', currentEventId, 'attendees', currentUser.uid));
        const hasRSVPd = attendeeDoc.exists();

        if (hasRSVPd) {
            // Cancel RSVP
            await deleteDoc(doc(db, 'eventAttendees', currentEventId, 'attendees', currentUser.uid));
            showToast('RSVP cancelled');

            const rsvpBtn = document.getElementById('rsvpBtn');
            rsvpBtn.textContent = 'RSVP';
            rsvpBtn.classList.remove('rsvped');
        } else {
            // Add RSVP
            await setDoc(doc(db, 'eventAttendees', currentEventId, 'attendees', currentUser.uid), {
                userId: currentUser.uid,
                userName: currentUser.displayName || currentUser.email,
                rsvpedAt: serverTimestamp()
            });
            showToast('RSVP confirmed!');

            const rsvpBtn = document.getElementById('rsvpBtn');
            rsvpBtn.textContent = 'CANCEL RSVP';
            rsvpBtn.classList.add('rsvped');
        }

        await loadAttendeeList(currentEventId);
    } catch (error) {
        console.error('Error toggling RSVP:', error);
        showToast('Error updating RSVP');
    }
});

// ==================== MARK ATTENDANCE ====================

async function setupMarkAttendance(restaurant) {
    const markAttendanceSection = document.getElementById('markAttendanceSection');
    const markAttendanceBtn = document.getElementById('markAttendanceBtn');
    const attendanceStatus = document.getElementById('attendanceStatus');

    // Check if this restaurant has an event date
    if (!restaurant.eventDate) {
        markAttendanceSection.classList.add('hidden');
        return;
    }

    const eventDate = restaurant.eventDate.toDate ? restaurant.eventDate.toDate() : new Date(restaurant.eventDate);
    const now = new Date();

    // Only show if event has started
    if (now < eventDate) {
        markAttendanceSection.classList.add('hidden');
        return;
    }

    // Check if user RSVP'd
    try {
        const attendeeDoc = await getDoc(doc(db, 'eventAttendees', restaurant.id, 'attendees', currentUser.uid));

        if (!attendeeDoc.exists()) {
            markAttendanceSection.classList.add('hidden');
            return;
        }

        const attendeeData = attendeeDoc.data();
        const hasAttended = attendeeData.attended || false;

        markAttendanceSection.classList.remove('hidden');

        if (hasAttended) {
            markAttendanceBtn.style.display = 'none';
            attendanceStatus.textContent = '✓ You marked yourself as attended';
            attendanceStatus.classList.add('attended');
        } else {
            markAttendanceBtn.style.display = 'block';
            attendanceStatus.textContent = '';
            attendanceStatus.classList.remove('attended');
        }
    } catch (error) {
        console.error('Error checking attendance:', error);
        markAttendanceSection.classList.add('hidden');
    }
}

// Mark attendance button click handler
document.getElementById('markAttendanceBtn').addEventListener('click', async () => {
    if (!currentRestaurant) return;

    try {
        await updateDoc(doc(db, 'eventAttendees', currentRestaurant.id, 'attendees', currentUser.uid), {
            attended: true,
            attendedAt: serverTimestamp()
        });

        showToast('Marked as attended!');

        document.getElementById('markAttendanceBtn').style.display = 'none';
        const attendanceStatus = document.getElementById('attendanceStatus');
        attendanceStatus.textContent = '✓ You marked yourself as attended';
        attendanceStatus.classList.add('attended');

        // Check if all attendees have rated - trigger report generation if so
        await checkAndGenerateRatingReport(currentRestaurant.id);
    } catch (error) {
        console.error('Error marking attendance:', error);
        showToast('Error marking attendance');
    }
});

// ==================== LOAD AND DISPLAY RATING REPORT ====================

async function loadRatingReport(restaurantId) {
    const reportSection = document.getElementById('ratingReportSection');

    try {
        const reportDoc = await getDoc(doc(db, 'ratingReports', restaurantId));

        if (reportDoc.exists()) {
            const report = reportDoc.data();

            // Show report section
            reportSection.classList.remove('hidden');

            // Populate report data
            document.getElementById('reportVerdict').textContent = report.verdict;
            document.getElementById('reportOverallAvg').textContent = `${report.overallAvg}/10`;
            document.getElementById('reportTotalRaters').textContent = report.totalRaters;

            // Populate superlatives
            document.getElementById('toughestCritic').textContent = report.superlatives.toughestCritic;
            document.getElementById('mostGenerous').textContent = report.superlatives.mostGenerous;
            document.getElementById('mealMaster').textContent = report.superlatives.mealMaster;
            document.getElementById('bathroomConnoisseur').textContent = report.superlatives.bathroomConnoisseur;
            document.getElementById('ambianceAficionado').textContent = report.superlatives.ambianceAficionado;
            document.getElementById('serviceSavant').textContent = report.superlatives.serviceSavant;
        } else {
            // No report exists - hide section
            reportSection.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error loading rating report:', error);
        reportSection.classList.add('hidden');
    }
}

// ==================== RATING REPORT GENERATION ====================

async function checkAndGenerateRatingReport(restaurantId) {
    try {
        // Get all attendees who marked attendance
        const attendeesSnapshot = await getDocs(collection(db, 'eventAttendees', restaurantId, 'attendees'));
        const attendedUsers = [];

        attendeesSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.attended) {
                attendedUsers.push({
                    userId: doc.id,
                    userName: data.userName
                });
            }
        });

        if (attendedUsers.length === 0) return;

        // Get all ratings for this restaurant
        const ratingsSnapshot = await getDocs(collection(db, 'restaurants', restaurantId, 'ratings'));
        const ratings = {};

        ratingsSnapshot.forEach(doc => {
            ratings[doc.id] = {
                userId: doc.id,
                ...doc.data()
            };
        });

        // Check if all attended users have rated
        const allHaveRated = attendedUsers.every(attendee => ratings[attendee.userId]);

        if (!allHaveRated) {
            console.log('Not all attendees have rated yet');
            return;
        }

        // Check if report already exists
        const reportDoc = await getDoc(doc(db, 'ratingReports', restaurantId));
        if (reportDoc.exists()) {
            console.log('Report already generated for this event');
            return;
        }

        // Generate the report
        const report = generateRatingReport(attendedUsers, ratings, restaurantId);

        // Save report to Firestore
        await setDoc(doc(db, 'ratingReports', restaurantId), {
            ...report,
            generatedAt: serverTimestamp()
        });

        // Send notification to all users
        const restaurantDoc = await getDoc(doc(db, 'restaurants', restaurantId));
        const restaurantName = restaurantDoc.data()?.name || 'Unknown';

        await addDoc(collection(db, 'notifications'), {
            message: `📊 Rating report for ${restaurantName} is ready!`,
            type: 'rating_report',
            restaurantId: restaurantId,
            timestamp: serverTimestamp()
        });

        console.log('Rating report generated and notification sent!');

        // Refresh the report display if we're currently viewing this restaurant
        if (currentRestaurant && currentRestaurant.id === restaurantId) {
            await loadRatingReport(restaurantId);
        }
    } catch (error) {
        console.error('Error generating rating report:', error);
    }
}

function generateRatingReport(attendedUsers, ratings, restaurantId) {
    const userRatings = attendedUsers.map(attendee => ({
        ...attendee,
        ...ratings[attendee.userId]
    }));

    // Calculate superlatives
    const superlatives = {};

    if (userRatings.length === 1) {
        // Solo diner - they win everything!
        const soloUser = userRatings[0];
        superlatives.toughestCritic = soloUser.userName;
        superlatives.mostGenerous = soloUser.userName;
        superlatives.mealMaster = soloUser.userName;
        superlatives.bathroomConnoisseur = soloUser.userName;
        superlatives.ambianceAficionado = soloUser.userName;
        superlatives.serviceSavant = soloUser.userName;
    } else {
        // Multiple attendees - calculate actual superlatives
        // Toughest Critic (lowest average)
        const averages = userRatings.map(user => ({
            userName: user.userName,
            avg: (user.meal + user.bathroom + user.ambiance + user.service) / 4
        }));
        const toughest = averages.reduce((min, user) => user.avg < min.avg ? user : min);
        superlatives.toughestCritic = toughest.userName;

        // Most Generous (highest average)
        const mostGenerous = averages.reduce((max, user) => user.avg > max.avg ? user : max);
        superlatives.mostGenerous = mostGenerous.userName;

        // Meal Master (highest meal rating)
        const mealMaster = userRatings.reduce((max, user) => user.meal > max.meal ? user : max);
        superlatives.mealMaster = mealMaster.userName;

        // Bathroom Connoisseur (highest bathroom rating)
        const bathroomConnoisseur = userRatings.reduce((max, user) => user.bathroom > max.bathroom ? user : max);
        superlatives.bathroomConnoisseur = bathroomConnoisseur.userName;

        // Ambiance Aficionado (highest ambiance rating)
        const ambianceAficionado = userRatings.reduce((max, user) => user.ambiance > max.ambiance ? user : max);
        superlatives.ambianceAficionado = ambianceAficionado.userName;

        // Service Savant (highest service rating)
        const serviceSavant = userRatings.reduce((max, user) => user.service > max.service ? user : max);
        superlatives.serviceSavant = serviceSavant.userName;
    }

    // Overall verdict
    const averages = userRatings.map(user => ({
        userName: user.userName,
        avg: (user.meal + user.bathroom + user.ambiance + user.service) / 4
    }));
    const overallAvg = averages.reduce((sum, user) => sum + user.avg, 0) / averages.length;
    let verdict = '';
    if (overallAvg >= 8) verdict = '🔥 Absolutely Fire!';
    else if (overallAvg >= 6.5) verdict = '👍 Solid Choice';
    else if (overallAvg >= 5) verdict = '😐 It Was Alright';
    else verdict = '👎 Maybe Skip This One';

    return {
        restaurantId,
        superlatives,
        verdict,
        overallAvg: overallAvg.toFixed(1),
        totalRaters: userRatings.length
    };
}

// ==================== DELETE RATING TOOL ====================

async function loadDeleteRatingDropdowns() {
    const restaurantSelect = document.getElementById('deleteRatingRestaurant');
    const userSelect = document.getElementById('deleteRatingUser');

    try {
        // Load all restaurants
        const restaurantsSnapshot = await getDocs(collection(db, 'restaurants'));
        restaurantSelect.innerHTML = '<option value="">Select a restaurant...</option>';

        restaurantsSnapshot.forEach(doc => {
            const restaurant = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = restaurant.name;
            restaurantSelect.appendChild(option);
        });

        // Load all users from sessions
        const sessionsSnapshot = await getDocs(collection(db, 'sessions'));
        const users = [];

        sessionsSnapshot.forEach(doc => {
            const sessionData = doc.data();
            users.push({
                userId: doc.id,
                userName: sessionData.userName || sessionData.email || 'Unknown'
            });
        });

        // Sort by name
        users.sort((a, b) => a.userName.localeCompare(b.userName));

        userSelect.innerHTML = '<option value="">Select a user...</option>';
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.userId;
            option.textContent = user.userName;
            userSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading delete rating dropdowns:', error);
    }
}

// Delete rating form submission
document.getElementById('deleteRatingForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
        showToast('Access denied - Admin only');
        return;
    }

    const restaurantId = document.getElementById('deleteRatingRestaurant').value;
    const userId = document.getElementById('deleteRatingUser').value;

    if (!restaurantId || !userId) {
        showToast('Please select both restaurant and user');
        return;
    }

    // Get restaurant and user names for confirmation
    const restaurantSelect = document.getElementById('deleteRatingRestaurant');
    const userSelect = document.getElementById('deleteRatingUser');
    const restaurantName = restaurantSelect.options[restaurantSelect.selectedIndex].text;
    const userName = userSelect.options[userSelect.selectedIndex].text;

    const confirmed = await showConfirmModal(
        'Delete Rating',
        `Delete ${userName}'s rating for ${restaurantName}?`
    );

    if (!confirmed) {
        return;
    }

    showLoading();
    try {
        // Delete the rating
        await deleteDoc(doc(db, 'restaurants', restaurantId, 'ratings', userId));

        // Recalculate rating count for the restaurant
        const ratingsSnapshot = await getDocs(collection(db, 'restaurants', restaurantId, 'ratings'));
        const newRatingCount = ratingsSnapshot.size;

        // Update restaurant's rating count
        await updateDoc(doc(db, 'restaurants', restaurantId), {
            ratingCount: newRatingCount
        });

        hideLoading();
        showToast('Rating deleted successfully!');

        // Reset form
        document.getElementById('deleteRatingForm').reset();
    } catch (error) {
        hideLoading();
        console.error('Error deleting rating:', error);
        showToast('Error deleting rating');
    }
});

// ==================== CONFIRMATION MODAL ====================

function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmModalTitle');
        const messageEl = document.getElementById('confirmModalMessage');
        const confirmBtn = document.getElementById('confirmModalConfirm');
        const cancelBtn = document.getElementById('confirmModalCancel');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        const handleConfirm = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(true);
        };

        const handleCancel = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(false);
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                handleCancel();
            }
        });
    });
}

// Initialize
console.log('Beachlands Curry Club initialized');
