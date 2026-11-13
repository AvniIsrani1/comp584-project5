import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// page elements
const globeDiv = document.getElementById("globe");
const summary = document.getElementById("summary");
const filterBar = document.getElementById("filters");
const eventList = document.getElementById("event-list");
const detailsBox = document.getElementById("details");
const searchForm = document.getElementById("search");
const startDate = document.getElementById("start");
const endDate = document.getElementById("end");
const searchButton = document.getElementById("search-button");
const backButton = document.getElementById("back-button");

// storing default message so that it can be put back after a new search
const defaultDetails = detailsBox.innerHTML;

// scene (holds everything that gets drawn)
const scene = new THREE.Scene();

// camera
const camera = new THREE.PerspectiveCamera(45, globeDiv.clientWidth / globeDiv.clientHeight, 0.1, 1000);
camera.position.z = 3;

// renderer details
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha=true so the css background shows behind the globe
renderer.setSize(globeDiv.clientWidth, globeDiv.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
globeDiv.appendChild(renderer.domElement);

// earth
const texture = new THREE.TextureLoader().load("https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/earth_atmos_2048.jpg");
texture.colorSpace = THREE.SRGBColorSpace;

// earth --> 3D
const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 50, 50),
    new THREE.MeshStandardMaterial({ map: texture })
);
scene.add(earth);

// lights
scene.add(new THREE.AmbientLight(0xFFFFFF, 1.5));
const sunLight = new THREE.DirectionalLight(0xFFFFFF, 2);
sunLight.position.set(5, 5, 5);
scene.add(sunLight);

// pin colors (for nasa earth events) are in the css
const styles = getComputedStyle(document.documentElement);
// take pin color from the css
const getCssColor = name => styles.getPropertyValue(name).trim();

// latitude/longitude to a point on the sphere lined up w/ the texture
const toGlobePosition = (latitude, longitude, radius) => new THREE.Vector3().setFromSphericalCoords(radius, THREE.MathUtils.degToRad(90 - latitude), THREE.MathUtils.degToRad(longitude + 90));

// events have a list of positions over time so takeing the last one
const lastPosition = event => event.geometry[event.geometry.length - 1];

// returns (lon, lat) bc geojson and polygons just use their first point
function getCoordinates(event) {
    const { type, coordinates } = lastPosition(event);
    return type === "Point" ? coordinates : coordinates[0][0];
}

// taking the first category for each event
const getCategory = event => event.categories[0];

// white if category has no color set
const categoryColor = id => getCssColor(`--pin-${id}`) || "#FFFFFF";

// color for an event based on its category
const eventColor = event => categoryColor(getCategory(event).id);

// small colored circle for tabs and the list
const makeDot = color => `<span class="dot" style="background: ${color}"></span>`;

// turns a date into format: ABBREVIATED_MONTH DAY YEAR
function formatDate(date) {
    return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// loaded events + which tab and event are picked
let allEvents = [];
let currentCategory = "all";
let selectedId = null;

// where the camera is turning to (null if not moving)
let cameraTarget = null;

// events in the current category tab
function shownEvents() {
    if (currentCategory === "all") {
        return allEvents;
    }
    return allEvents.filter(event => getCategory(event).id === currentCategory);
}

// pins share geometry
const pins = new THREE.Group();
scene.add(pins);
const pinGeometry = new THREE.SphereGeometry(0.02, 10, 10);

// put a pin on the globe for each event
function drawPins(events) {
    // free up each old pins material then clear them all out
    pins.children.forEach(pin => pin.material.dispose());
    pins.clear();

    // make a new pin for every event
    events.forEach(event => {
        const [longitude, latitude] = getCoordinates(event);

        const pin = new THREE.Mesh(
            pinGeometry,
            new THREE.MeshBasicMaterial({ color: eventColor(event) })
        );
        // put it right on the surface
        pin.position.copy(toGlobePosition(latitude, longitude, 1));
        // keep the event on the pin so clicks know which one it is
        pin.userData.event = event;

        pins.add(pin);
    });
}

// build the category tabs and show how many events are in each
function drawTabs() {
    // count how many events are in each category
    const counts = {};
    allEvents.forEach(event => {
        const { id, title } = getCategory(event);
        if (!counts[id]) {
            counts[id] = { title, count: 0 };
        }
        counts[id].count++;
    });

    // list of tabs w/ all at the front followed by each category
    const tabs = [{ id: "all", title: "All", count: allEvents.length }];
    for (const id in counts) {
        tabs.push({ id, title: counts[id].title, count: counts[id].count });
    }

    // turn each tab into a button with its color dot and count and highlight the current one
    filterBar.innerHTML = tabs
        .map(({ id, title, count }) => `
            <button class="filter-button ${id === currentCategory ? "active" : ""}" data-category="${id}">
                ${id === "all" ? "" : makeDot(categoryColor(id))}${title} <span class="count">${count}</span>
            </button>`)
        .join("");
}

// when a tab is clicked, switch to its category and redraw everything
filterBar.addEventListener("click", clickEvent => {
    // closest so clicking the dot or count inside the tab still works
    const tab = clickEvent.target.closest(".filter-button");
    if (tab) {
        currentCategory = tab.dataset.category;
        redraw();
    }
});

// fill the sidebar w/ row for each event
function drawList(events) {
    // nothing to show 
    if (!events.length) {
        eventList.innerHTML = `<li class="empty">No events found.</li>`;
        return;
    }

    // each row gets dot title category and date
    // the picked one is also highlighted
    eventList.innerHTML = events
        .map(event => `
            <li class="event-item ${event.id === selectedId ? "selected" : ""}" data-id="${event.id}">
                ${makeDot(eventColor(event))}
                <div>
                    ${event.title}
                    <small>${getCategory(event).title} - ${formatDate(lastPosition(event).date)}</small>
                </div>
            </li>`)
        .join("");
}

// when a row is clicked, select that event
eventList.addEventListener("click", clickEvent => {
    // closest so clicking the dot or text inside the row still works
    const row = clickEvent.target.closest(".event-item");
    if (row) {
        // the row only stores the id so look up the full event
        selectEvent(allEvents.find(event => event.id === row.dataset.id));
    }
});

// select an event and show its details and turn the globe to face it
function selectEvent(event) {
    selectedId = event.id;

    const latest = lastPosition(event);
    const [longitude, latitude] = getCoordinates(event);

    // only some events have magnitude so leave out if missing
    let magnitude = "";
    if (latest.magnitudeValue != null) {
        magnitude = `<dt>Magnitude</dt><dd>${latest.magnitudeValue} ${latest.magnitudeUnit}</dd>`;
    }

    // fill the details box
    detailsBox.innerHTML = `
        <h2>${event.title}</h2>
        <dl>
            <dt>Category</dt><dd>${getCategory(event).title}</dd>
            <dt>Updated</dt><dd>${formatDate(latest.date)}</dd>
            <dt>Location</dt><dd>${latitude.toFixed(2)}, ${longitude.toFixed(2)}</dd>
            ${magnitude}
        </dl>`;

    // stop spinning and aim the camera at the event at the same zoom
    controls.autoRotate = false;
    cameraTarget = toGlobePosition(latitude, longitude, camera.position.length());

    // redraw the list so the row highlights then scroll to it
    drawList(shownEvents());
    eventList.querySelector(`[data-id="${event.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// redraw anything tied to the category tab
function redraw() {
    const events = shownEvents();
    drawTabs();
    drawPins(events);
    drawList(events);
}

// drag to rotate / scroll to zoom / no panning
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;

// damping makes the globe glide a bit after you let go
controls.enableDamping = true;

// how close and far you can zoom
controls.minDistance = 1.5;
controls.maxDistance = 5;

// slow spin until an event is picked
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

// if the user grabs the globe stop turning toward the picked event
controls.addEventListener("start", () => { cameraTarget = null; });

// used to shoot a line from the camera through the mouse to see what it hits
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// find the pin under the mouse or null if there isnt one
function pinUnderMouse(pointerEvent) {
    // turn the mouse position into webgl coords that go from minus 1 to 1
    const box = renderer.domElement.getBoundingClientRect();
    mouse.x = ((pointerEvent.clientX - box.left) / box.width) * 2 - 1;
    mouse.y = -((pointerEvent.clientY - box.top) / box.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // check the earth so pins on the back side are blocked by it
    const hit = raycaster.intersectObjects([earth, ...pins.children])[0];
    if (!hit || hit.object === earth) {
        return null;
    }
    return hit.object;
}

// where the mouse went down so we can tell clicks apart from drags
let pressStart = null;

// save the spot when the mouse goes down on the globe
renderer.domElement.addEventListener("pointerdown", pointerEvent => {
    pressStart = { x: pointerEvent.clientX, y: pointerEvent.clientY };
});

// when the mouse comes back up select the pin under it but only if it was a click
renderer.domElement.addEventListener("pointerup", pointerEvent => {
    // press started somewhere else so ignore it
    if (!pressStart) {
        return;
    }

    // moving more than 5 pixels counts as a drag not a click
    const moved = Math.hypot(pointerEvent.clientX - pressStart.x, pointerEvent.clientY - pressStart.y);
    pressStart = null;
    if (moved > 5) {
        return;
    }

    const pin = pinUnderMouse(pointerEvent);
    if (pin) {
        selectEvent(pin.userData.event);
    }
});

// pointer cursor when hovering a pin
renderer.domElement.addEventListener("pointermove", pointerEvent => {
    renderer.domElement.style.cursor = pinUnderMouse(pointerEvent) ? "pointer" : "grab";
});

// animation loop
const clock = new THREE.Clock();

// runs every frame to move things and redraw the scene
function animate() {
    // ask the browser to call this again next frame
    requestAnimationFrame(animate);

    // goes smoothly back and forth between 1 and 3 over time
    const pulse = 2 + Math.sin(clock.getElapsedTime() * 3);

    // the selected pin pulses and the rest stay normal size
    pins.children.forEach(pin => pin.scale.setScalar(pin.userData.event.id === selectedId ? pulse : 1));

    // move the camera 5% closer to the target each frame and keep the same zoom
    if (cameraTarget) {
        const distance = camera.position.length();
        camera.position.lerp(cameraTarget, 0.05).setLength(distance);

        // close enough so stop moving
        if (camera.position.distanceTo(cameraTarget) < 0.01) {
            cameraTarget = null;
        }
    }

    // apply the spin and damping then draw
    controls.update();
    renderer.render(scene, camera);
}
animate();

// resize canvas with window
window.addEventListener("resize", () => {
    camera.aspect = globeDiv.clientWidth / globeDiv.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(globeDiv.clientWidth, globeDiv.clientHeight);
});

// eonet api
const apiUrl = "https://eonet.gsfc.nasa.gov/api/v3/events";

// show a red message in the summary line
const showError = message => {
    summary.innerHTML = `<span class="error">${message}</span>`;
};

// en ca locale to get yyyy mm dd in local time
const dateForInput = date => date.toLocaleDateString("en-CA");

// parse as local time so it doesnt show the day before
const formatPickedDate = value => formatDate(`${value}T00:00`);

// get events from the api and redraw the page and label is the text after the count in the summary
async function loadEvents(url, label) {
    // show loading and lock the buttons so nobody fires off a second search
    summary.textContent = "Loading events...";
    searchButton.disabled = true;
    backButton.disabled = true;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        const data = await response.json();

        // skip any w/ no location then sort newest first
        allEvents = data.events
            .filter(event => event.geometry.length)
            .sort((a, b) => new Date(lastPosition(b).date) - new Date(lastPosition(a).date));

        // new results so clear the old tab and pick
        currentCategory = "all";
        selectedId = null;
        cameraTarget = null;
        detailsBox.innerHTML = defaultDetails;

        // X events from the past 30 days
        const count = allEvents.length;
        summary.textContent = `${count} ${count === 1 ? "event" : "events"} ${label}.`;
        redraw();
    } catch (error) {
        // network problem or bad status
        showError(`Couldn't load events. ${error.message}`);
    }

    // unlock the buttons
    searchButton.disabled = false;
    backButton.disabled = false;
}

// default view is open events from the last 30 days
function loadRecent() {
    loadEvents(`${apiUrl}?status=open&days=30`, "still active from the past 30 days");
}

// fill the date boxes with the last 30 days
function resetDates() {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);

    startDate.value = dateForInput(monthAgo);
    endDate.value = dateForInput(new Date());
}

// search the picked date range
searchForm.addEventListener("submit", submitEvent => {
    // stop the page from reloading
    submitEvent.preventDefault();
    const start = startDate.value;
    const end = endDate.value;

    if (start > end) {
        showError("Start date needs to be before the end date.");
        return;
    }

    // status all so closed events in the range show up too
    loadEvents(
        `${apiUrl}?status=all&start=${start}&end=${end}`,
        `between ${formatPickedDate(start)} and ${formatPickedDate(end)}`
    );
    backButton.hidden = false;
});

// go back to the default view
backButton.addEventListener("click", () => {
    resetDates();
    backButton.hidden = true;
    loadRecent();
});

// no picking future dates
startDate.max = endDate.max = dateForInput(new Date());
resetDates();
loadRecent();