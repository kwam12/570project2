// JavaScript can be added here later

// --- Function to Update Cart Count Icon (Global) ---
const updateCartIconCount = () => {
    // Use a more specific selector targeting the badge within the loaded header
    const cartBadge = document.querySelector('#header-placeholder #cart-item-count'); 
    console.log("Attempting to update cart count. Badge element found:", cartBadge); // Add log
    if (!cartBadge) {
         //console.log("Cart badge not found yet, skipping update.");
         return; // Exit quietly if badge element not found yet
    }

    try {
        const cart = JSON.parse(localStorage.getItem('shoppingCart')) || [];
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

        cartBadge.textContent = totalItems;
        if (totalItems > 0) {
            cartBadge.classList.add('visible');
        } else {
            cartBadge.classList.remove('visible');
        }
    } catch (error) {
        console.error("Error reading cart from localStorage:", error);
         cartBadge.classList.remove('visible'); // Hide badge on error
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Function to load HTML content into an element
    const loadHTML = async (selector, url) => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.text();
            const element = document.querySelector(selector);
            if (element) {
                element.innerHTML = data;
            } else {
                console.error(`Element with selector "${selector}" not found.`);
            }
        } catch (error) {
            console.error('Error loading HTML:', error);
        }
    };

    // --- Currency to Country Code Mapping --- 
    const currencyToCountryMap = {
        USD: 'US',
        CAD: 'CA',
        EUR: 'EU', // Use EU flag for Euro
        GBP: 'GB'
        // Add more mappings as needed
    };

    // --- Function to update flag ---
    const updateFlag = (currencyCode) => {
        const countryCode = currencyToCountryMap[currencyCode];
        const flagImg = document.querySelector('#header-placeholder .country-flag'); // Select within placeholder
        
        if (flagImg && countryCode) {
            flagImg.src = `https://purecatamphetamine.github.io/country-flag-icons/3x2/${countryCode}.svg`;
            flagImg.style.display = 'inline-block'; // Show the flag
            flagImg.alt = `${currencyCode} Flag`;
        } else if (flagImg) {
            flagImg.style.display = 'none'; // Hide if no mapping
        }
    };

    // Load the reusable header and THEN set up listeners and check auth state
    loadHTML('#header-placeholder', '/header.html').then(() => {
        const currencySelect = document.querySelector('#header-placeholder .currency-select');
        const profileLink = document.querySelector('#header-placeholder #profile-link');
        const loginLink = document.querySelector('#header-placeholder #login-link');
        
        // Check login state and toggle UI elements
        const token = localStorage.getItem('authToken');
        if (profileLink) {
            profileLink.style.display = token ? 'inline-block' : 'none'; // Show if logged in
        }
        if (loginLink) {
            loginLink.style.display = token ? 'none' : 'inline-block'; // Hide if logged in
        }

        if (currencySelect) {
            // --- Load saved currency or use default ---
            const savedCurrency = localStorage.getItem('selectedCurrency');
            if (savedCurrency && currencySelect.querySelector(`option[value="${savedCurrency}"]`)) { // Check if saved option exists
                currencySelect.value = savedCurrency;
            } else {
                // Default to USD if nothing saved or saved value is invalid
                localStorage.setItem('selectedCurrency', currencySelect.value); 
            }
            // --- End Load Saved Currency ---
            
             // Set initial flag based on loaded/default selection
            updateFlag(currencySelect.value); 

            // Add event listener for changes
            currencySelect.addEventListener('change', (event) => {
                const newCurrency = event.target.value;
                updateFlag(newCurrency);
                // Save selected currency to localStorage
                localStorage.setItem('selectedCurrency', newCurrency);
                console.log('Saved currency:', newCurrency);
                // Add logic here if prices need to change based on currency
            });
        } else {
            console.error("Currency select dropdown not found after header load.");
        }
        console.log("Header Loaded and Initial State Set (Auth, Currency)");

        // --- Search Form Handler ---
        const searchForm = document.querySelector('#header-placeholder .search-form');
        const searchInput = document.querySelector('#header-placeholder .search-input');

        if (searchForm && searchInput) {
            searchForm.addEventListener('submit', (event) => {
                event.preventDefault(); // Prevent default form submission
                const query = searchInput.value.trim();
                if (query) {
                    // Redirect to products page with search query
                    window.location.href = `/products.html?search=${encodeURIComponent(query)}`;
                }
            });
        } else {
             console.error("Search form or input not found after header load.");
        }
        // --- End Search Form Handler ---

        // --- Initial Cart Icon Update ---
        updateCartIconCount(); // Call the global function
        
        // --- Listen for cart changes to update icon ---
        document.addEventListener('cartUpdated', () => {
            console.log("'cartUpdated' event received, updating icon count."); // Log event
            updateCartIconCount();
        });

    });

    // Load the reusable footer
    loadHTML('#footer-placeholder', '/footer.html');

    // --- Other potential JavaScript code --- 
    console.log("Skims Clone Loaded");

}); 