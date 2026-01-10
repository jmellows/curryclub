// One-time script to delete test restaurants from Firestore
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getFirestore,
    collection,
    getDocs,
    deleteDoc,
    doc,
    query,
    where
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
const db = getFirestore(app);

async function deleteTestRestaurants() {
    console.log('Starting deletion of test restaurants...');

    try {
        // Get all restaurants
        const restaurantsSnapshot = await getDocs(collection(db, 'restaurants'));

        let deletedCount = 0;

        for (const restaurantDoc of restaurantsSnapshot.docs) {
            const restaurantData = restaurantDoc.data();
            const restaurantName = restaurantData.name.toLowerCase();

            // Check if it's test3 or test4
            if (restaurantName === 'test3' || restaurantName === 'test4' || restaurantName === 'tesg3') {
                console.log(`Found: ${restaurantData.name} (ID: ${restaurantDoc.id})`);

                // Delete all ratings first
                const ratingsSnapshot = await getDocs(collection(db, 'restaurants', restaurantDoc.id, 'ratings'));
                console.log(`  - Deleting ${ratingsSnapshot.size} ratings...`);

                for (const ratingDoc of ratingsSnapshot.docs) {
                    await deleteDoc(ratingDoc.ref);
                }

                // Delete the restaurant document
                await deleteDoc(doc(db, 'restaurants', restaurantDoc.id));
                console.log(`  - Deleted restaurant: ${restaurantData.name}`);

                deletedCount++;
            }
        }

        console.log(`\n✅ Deletion complete! Removed ${deletedCount} test restaurant(s).`);

        if (deletedCount === 0) {
            console.log('ℹ️  No test restaurants found (test3, test4, or tesg3).');
        }

    } catch (error) {
        console.error('❌ Error deleting restaurants:', error);
    }
}

// Run the deletion
deleteTestRestaurants();
