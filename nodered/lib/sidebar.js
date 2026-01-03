// Custom Sidebar Injection for Node-RED
(function () {
    console.log("Loading custom sidebar script...");
    // Wait for DOM
    $(function () {
        console.log("DOM ready, injecting sidebar...");
        const sidebarHTML = `
        <div id="custom-sidebar">
            <div class="sidebar-header">Traffic Manager</div>
            <ul>
                <li><a href="http://localhost:3000/views/dashboard">🏠 Dashboard</a></li>
                <li><a href="http://localhost:3000/views/camera-manager">📷 Camera Manager</a></li>
                <li><a href="http://localhost:3000/views/combined">🚦 Traffic Control</a></li>
                <li><a href="/" class="active">⚙️ Node-RED</a></li>
                <li><a href="http://localhost:3000/views/settings">🔧 Settings</a></li>
                <li><a href="http://localhost:3000/api/auth/logout">🚪 Logout</a></li>
            </ul>
        </div>
        <button id="sidebar-toggle-btn">☰</button>
        `;

        $('body').prepend(sidebarHTML);

        // Toggle logic
        const sidebar = $('#custom-sidebar');
        const toggleBtn = $('#sidebar-toggle-btn');
        const mainElems = $('#header, #main-container, #workspace'); // Node-RED main elements

        function toggleSidebar() {
            sidebar.toggleClass('collapsed');
            toggleBtn.toggleClass('collapsed');

            if (sidebar.hasClass('collapsed')) {
                mainElems.css({ 'left': '0', 'width': '100%' });
            } else {
                mainElems.attr('style', ''); // Restore CSS override
                // Re-apply property if !important in CSS forces it, 
                // but usually removing inline style allows stylesheet to take over.
                // Since our CSS uses !important for open state, we might need JS to force clear or specific class.
                // Actually, let's use a class on body for easier state management
                $('body').toggleClass('sidebar-closed');
            }
        }

        toggleBtn.click(toggleSidebar);

        // Adjust CSS via class
        $('body').addClass('custom-sidebar-enabled');
    });
})();
