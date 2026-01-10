// Create curry bowls display
function createCurryBowls(rating, containerElement, animate = false) {
    containerElement.innerHTML = '';
    const fullBowls = Math.floor(rating);
    const hasHalfBowl = rating % 1 >= 0.5;

    for (let i = 0; i < 10; i++) {
        const bowl = document.createElement('div');
        bowl.className = 'curry-bowl';

        if (i < fullBowls || (i === fullBowls && hasHalfBowl)) {
            if (animate) {
                setTimeout(() => {
                    bowl.classList.add('filled');
                }, i * 50);
            } else {
                bowl.classList.add('filled');
            }
        }

        containerElement.appendChild(bowl);
    }
}

// Load restaurant details from sessionStorage
function loadRestaurantDetails() {
    const restaurantData = sessionStorage.getItem('selectedRestaurant');

    if (!restaurantData) {
        // If no restaurant data, redirect to dashboard
        window.location.href = 'dashboard.html';
        return;
    }

    const restaurant = JSON.parse(restaurantData);

    // Set restaurant name
    document.getElementById('detailRestaurantName').textContent = restaurant.name;

    // Render each category rating with animation
    const categories = ['meal', 'bathroom', 'ambiance', 'service'];
    categories.forEach((category, index) => {
        const rating = restaurant.ratings[category];
        const bowlsEl = document.getElementById(category + 'Rating');
        const numberEl = document.getElementById(category + 'Number');

        // Clear previous content
        bowlsEl.innerHTML = '';
        numberEl.textContent = '';

        // Animate after a delay
        setTimeout(() => {
            createCurryBowls(rating, bowlsEl, true);
            numberEl.textContent = rating + '/10';
        }, index * 100);
    });
}

// Back button
document.getElementById('backBtn').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
});

// Initialize
loadRestaurantDetails();
