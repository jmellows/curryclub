// Demo restaurant data
const restaurants = [
    {
        id: 1,
        name: "Spice Palace",
        ratings: {
            meal: 9.5,
            bathroom: 8.0,
            ambiance: 9.0,
            service: 9.5
        }
    },
    {
        id: 2,
        name: "Curry Heaven",
        ratings: {
            meal: 9.0,
            bathroom: 8.5,
            ambiance: 8.5,
            service: 9.0
        }
    },
    {
        id: 3,
        name: "Bombay Bites",
        ratings: {
            meal: 8.5,
            bathroom: 7.5,
            ambiance: 8.0,
            service: 8.5
        }
    },
    {
        id: 4,
        name: "Tandoori Nights",
        ratings: {
            meal: 8.0,
            bathroom: 8.0,
            ambiance: 7.5,
            service: 8.0
        }
    },
    {
        id: 5,
        name: "Masala Magic",
        ratings: {
            meal: 7.5,
            bathroom: 7.0,
            ambiance: 7.5,
            service: 7.5
        }
    }
];

// Calculate average rating for a restaurant
function calculateAverage(ratings) {
    const values = Object.values(ratings);
    const sum = values.reduce((acc, val) => acc + val, 0);
    return (sum / values.length).toFixed(1);
}

// Add average to each restaurant
restaurants.forEach(restaurant => {
    restaurant.average = parseFloat(calculateAverage(restaurant.ratings));
});

// Sort restaurants by average rating
restaurants.sort((a, b) => b.average - a.average);

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

// Helper function to generate random dates
function getRandomDate() {
    const days = Math.floor(Math.random() * 60) + 1;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 14) return '1 week ago';
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
}

// Render dashboard
function renderDashboard() {
    // Update stats
    document.getElementById('totalRestaurants').textContent = restaurants.length;
    document.getElementById('totalVisits').textContent = restaurants.length * 2; // Demo: assume 2 visits per restaurant
    const overallAverage = (restaurants.reduce((sum, r) => sum + r.average, 0) / restaurants.length).toFixed(1);
    document.getElementById('overallAverage').textContent = overallAverage;

    // Render podium (top 3)
    const podiumItems = document.querySelectorAll('.podium-item');
    podiumItems.forEach((item, index) => {
        const rank = parseInt(item.dataset.rank);
        const restaurant = restaurants[rank - 1];

        if (restaurant) {
            item.style.display = 'flex';
            const nameEl = item.querySelector('.restaurant-name');
            const bowlsEl = item.querySelector('.curry-bowls');
            const numberEl = item.querySelector('.rating-number');

            nameEl.textContent = restaurant.name;
            createCurryBowls(restaurant.average, bowlsEl);
            numberEl.textContent = restaurant.average + '/10';

            // Add click handler - store restaurant data in sessionStorage
            item.onclick = () => {
                sessionStorage.setItem('selectedRestaurant', JSON.stringify(restaurant));
                window.location.href = 'detail.html';
            };
        } else {
            item.style.display = 'none';
        }
    });

    // Render list (4th onwards)
    const listContainer = document.getElementById('restaurantList');
    listContainer.innerHTML = '';

    for (let i = 3; i < restaurants.length; i++) {
        const restaurant = restaurants[i];
        const card = document.createElement('div');
        card.className = 'list-card';

        card.innerHTML = `
            <div class="list-rank">${i + 1}</div>
            <div class="list-info">
                <div class="list-name">${restaurant.name}</div>
                <div class="list-subtitle">Last visit: ${getRandomDate()}</div>
            </div>
            <div class="list-rating">
                <div class="curry-bowls"></div>
                <div class="rating-number">${restaurant.average}/10</div>
            </div>
        `;

        const bowlsContainer = card.querySelector('.curry-bowls');
        createCurryBowls(restaurant.average, bowlsContainer);

        card.onclick = () => {
            sessionStorage.setItem('selectedRestaurant', JSON.stringify(restaurant));
            window.location.href = 'detail.html';
        };
        listContainer.appendChild(card);
    }

    // Handle empty state
    const emptyState = document.getElementById('emptyState');
    if (restaurants.length === 0) {
        emptyState.classList.remove('hidden');
        document.querySelector('.podium-section').style.display = 'none';
        listContainer.style.display = 'none';
    } else {
        emptyState.classList.add('hidden');
        document.querySelector('.podium-section').style.display = 'block';
        listContainer.style.display = 'block';
    }

    // Add scroll bounce effect
    let isAtBottom = false;
    window.addEventListener('scroll', () => {
        const scrollPosition = window.innerHeight + window.scrollY;
        const documentHeight = document.documentElement.scrollHeight;

        if (scrollPosition >= documentHeight - 10 && !isAtBottom) {
            isAtBottom = true;
            listContainer.classList.add('bounce');
            setTimeout(() => {
                listContainer.classList.remove('bounce');
            }, 400);
        } else if (scrollPosition < documentHeight - 50) {
            isAtBottom = false;
        }
    });
}

// Initialize
renderDashboard();
