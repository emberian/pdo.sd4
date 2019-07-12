// ==UserScript==
// @name     PDO.SD4
// @version  1
// @grant    none
// ==/UserScript==

function to_list(l: NodeListOf<HTMLElement>): Array<HTMLElement> { let res: Array<HTMLElement> = []; l.forEach(e => res.push(e)); return res };
function toCoordString(n: number[]): string {
    return n[0].toString() + '-' + n[1].toString();
}

declare function MapUpdate(data: any): void;

class Planet {
    uuid: string;
    coords: [number, number];
    dom_elt: HTMLElement;
    view_frame: HTMLIFrameElement;

    constructor(uuid: string, coords: [number, number], dom_elt: HTMLElement) {
        this.uuid = uuid
        this.coords = coords
        this.dom_elt = dom_elt
    }

    get document(): Promise<HTMLDocument> {
        if (this.view_frame) { return Promise.resolve(this.view_frame.contentDocument); }
        let self = this;
        return new Promise<HTMLDocument>(function (resolve, reject) {
            const pbody = document.createElement("iframe");
            window.addEventListener("message", e => { resolve(pbody.contentDocument); }, { once: true });
            pbody.addEventListener("error", e => { reject(); }, { once: true });
            pbody.height = "50";
            document.body.appendChild(pbody);
            pbody.src = `https://sd4.arke.me/Map/PlanetaryBody/${self.uuid}`;
        })
    }
}

class System {
    uuid: string;
    constructor(uuid: string) { this.uuid = uuid; }
}

class Fleet {
    uuid: string;
    last_known_coords: [number, number];

    static ofLocation(last_known_coords: [number, number]) {
        let self = new Fleet();
        self.last_known_coords = last_known_coords;
        return self;
    }

    async findUuid(planet_uuid_hint: string): Promise<string> {
        // find the fleet uuid, which annoyingly isn't exposed _anywhere_ else.
        if (this.uuid) { return this.uuid; }

        const resp = await fetch(`/Military/EmbarkArmyChoice?PlanetaryBodyId=${planet_uuid_hint}&_=${Date.now()}`, { method: "GET" });
        const r = document.createRange().createContextualFragment(await resp.text());
        let fleetId = to_list(r.querySelectorAll("#EmbarkalbeFleetList option:not([id=\"None\"])")).filter(o => o.textContent.match(/Settler/))[0].id;
        this.uuid = fleetId;
        return fleetId;
    }
}

declare var SettlerFleet: Fleet;

SettlerFleet = null;

enum BuildingType {
    Fab = "Resource Fabricator",
    P = "Orbital Elevator",
}

enum SpaceBuildingType {
    J = "Jump Gate",
    S = "Solar Array",
}

class cmr {

    constructor() {

    }

    static detectPlanets(): Array<Planet> {
        let detected_planets: Array<Planet> = [];
        document.querySelectorAll<HTMLElement>('.GalaxyMapButton').forEach((sq, _) => {
            if (sq.style.borderColor !== "blue") {
                const a = sq.children[0] as HTMLAnchorElement;
                if (!(!a || !a.href)) {
                    var match = a.href.match(/PlanetaryBody\/(.*)/)
                    if (match) {
                        detected_planets.push(new Planet(match[1], sq.id.split('-').map(i => parseInt(i)) as [number, number], sq));
                    }
                }
            }
        });
        return detected_planets;
    }

    static detectStars(): Array<[number, number]> {
        let detected_planets: Array<[number, number]> = [];
        document.querySelectorAll<HTMLElement>('.GalaxyMapButton').forEach((sq, _) => {
            const a = sq.children[0] as HTMLDivElement;
            if (!(!a)) {
                var match = a.style.background.match(/Star/);
                if (match) {
                    detected_planets.push(sq.id.split('-').map(i => parseInt(i)) as [number, number]);
                }
            }
        }
        );
        return detected_planets;
    }

    static findOpenNeighbors([x, y]: [number, number]): [number, number][] {
        const all_neighbors = [
            [x - 1, y - 1], [x, y - 1], [x + 1, y - 1],
            [x - 1, y], [x + 1, y],
            [x - 1, y + 1], [x, y + 1], [x + 1, y + 1]];
        let res: [number, number][] = [];
        for (const n of all_neighbors) {
            const elt = document.querySelectorAll<HTMLElement>(`[id="${toCoordString(n)}"]:empty`);
            if (elt) res.push(n as [number, number]);
        }
        return res
    }

    static findOpenNeighbor([x, y]: [number, number]): [number, number] {
        return this.findOpenNeighbors([x, y])[0];
    }

    static async findSettlerFleet(): Promise<Fleet> {
        if (SettlerFleet !== null) { return Promise.resolve(SettlerFleet); }
        // TODO: call UpgradeFleet on each fleet icon in view, check if name is /Settler.*/?
        const resp = await fetch(`/Military/Fleets?_=${Date.now()}`, { method: "GET" });
        const r = document.createRange().createContextualFragment(await resp.text());
        let fleets = to_list(r.querySelectorAll("#FleetsDiv tr[id*=\"-\"]"));
        for (let fleet of
            to_list(document.querySelectorAll('div.CanDragFleet'))
                .map(e => Fleet.ofLocation(e.id.split("_")[1]
                    .split("-").map(x => parseInt(x)) as [number, number]))) {
            let [x, y] = fleet.last_known_coords;
            let loc_col = `${String.fromCharCode(64 + x)}${y}`;
            let maybe_result = fleets.filter(f => f.children[0].textContent.match(/Settler/)
                    && f.children[2].textContent === loc_col);
            if (maybe_result.length != 0) { SettlerFleet = fleet; fleet.uuid = (maybe_result[0].children[1].children[0] as HTMLAnchorElement).href; return Promise.resolve(fleet); }
        }
        return Promise.reject(`Couldn't find any settler in this system.`)
    }

    static systemId(): string {
        return document.querySelectorAll("#StarSystemId")[0].textContent;
    }

    static planetId() {
        return new Planet(document.querySelectorAll("#PlanetaryBodyId")[0].textContent, null, null);
    }

    static async moveFleet(fleet: Fleet, dest: [number, number]) {
        // TODO: this finds the first fleet. how can we check it matches the one we're looking for?
        var fleet_sq = document.querySelectorAll('div.CanDragFleet')[0].id.split("_")[1].split("-").map(x => parseInt(x));
        if (fleet_sq === dest) { return Promise.resolve(null); }
        var fd = new URLSearchParams();
        fd.append('TargetLocation', toCoordString(dest));
        fd.append('SourceLocation', toCoordString(fleet.last_known_coords === null ? fleet_sq : fleet.last_known_coords));
        fd.append('SystemId', cmr.systemId());
        await fetch('/War/MoveFleetToBody', { method: "POST", body: fd });
        fleet.last_known_coords = dest;
    }

    static async drop(planet: Planet, armyId: string, openSquare: [number, number]) {
        console.log(`Dropping on ${openSquare}`);
        var fd = new URLSearchParams();
        fd.append('BodyId', planet.uuid);
        fd.append('EmbarkedArmyId', armyId);
        fd.append('TargetLocation', toCoordString(openSquare));
        await fetch('/Military/OrbitallyDrop', { method: "POST", body: fd });
    }

    static async embark(planet: Planet, armyId: string, fleet: Fleet, openSquare: [number, number]) {
        var fd = new URLSearchParams();
        fd.append('BodyId', planet.uuid);

        fd.append('FleetId', await fleet.findUuid(planet.uuid));

        fd.append('TargetLocation', toCoordString(openSquare));
        await fetch('/Military/EmbarkOntoFleet', { method: "POST", body: fd });
    }

    static async buildLand(planet: Planet, square: [number, number], building: BuildingType, update?: boolean) {
        console.log(`Building a ${building} at ${square} on ${planet.uuid}`);
        let doc = await planet.document;
        function LandMapUpdate(data) {
            $(doc.body).find('#MapIcon_' + data.ImageTargetId)[0].innerHTML = data.ImageTarget;
            if (data.AllowTargetDraggable == true) {
                $(doc.body).find('#Army_' + data.ImageTargetId).draggable({
                    snap: '.GalaxyMapButton',
                    snapMode: 'inner',
                    helper: 'clone'
                });
            }
            else {
                $(doc.body).find('#' + data.ImageTargetId).draggable('disable');
            }

            if (data.ImageSourceId != '') {
                $(doc.body).find('#MapIcon_' + data.ImageSourceId)[0].innerHTML = data.ImageSource;
                if (data.AllowSourceDraggable == true) {
                    $(doc.body).find('#Army_' + data.ImageSourceId).draggable({
                        snap: '.GalaxyMapButton',
                        snapMode: 'inner',
                        helper: 'clone'
                    });
                }
                else {
                    $(doc.body).find('#' + data.ImageSourceId).draggable('disable');
                }
            }
        }
        var fd = new URLSearchParams();
        fd.append('BodyId', planet.uuid);
        fd.append('BuildingType', building);
        fd.append('TargetLocation', toCoordString(square));
        const resp = await fetch('/Economy/BuildBuilding', { method: "POST", body: fd, referrer: `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}` });
        if (update) { LandMapUpdate(await resp.json()) };
    }

    // duplication for really just, what, two/three string constants?
    static async buildSpace(system: System, square: [number, number], building: SpaceBuildingType, update?: boolean) {
        console.log(`Building a ${building} at ${square} in ${system.uuid}`);
        function SpaceMapUpdate(data) {
            $('#MapIcon_' + data.ImageTargetId)[0].innerHTML = data.ImageTarget;
            if (data.AllowTargetDraggable == true) {
                $('#Fleet_' + data.ImageTargetId).draggable({
                    snap: '.GalaxyMapButton',
                    snapMode: 'inner',
                    helper: 'clone'
                });
            }
            else {
                $('#' + data.ImageTargetId).draggable('disable');
            }

            if (data.ImageSourceId != '') {
                $('#MapIcon_' + data.ImageSourceId)[0].innerHTML = data.ImageSource;
                if (data.AllowSourceDraggable == true) {
                    $('#Fleet_' + data.ImageSourceId).draggable({
                        snap: '.GalaxyMapButton',
                        snapMode: 'inner',
                        helper: 'clone'
                    });
                }
                else {
                    $('#' + data.ImageSourceId).draggable('disable');
                }
            }
        }
        var fd = new URLSearchParams();
        fd.append('SystemId', system.uuid);
        fd.append('BuildingType', building);
        fd.append('TargetLocation', toCoordString(square));
        const resp = await fetch('/Economy/BuildOnPlanetaryBody', { method: "POST", body: fd });
        if (update) { SpaceMapUpdate(await resp.json()) };
    }

    static async findOpenPlanetSquare(planet: Planet): Promise<[number, number]> {
        for (const elt of (await planet.document).querySelectorAll('span.GalaxyMapButton:empty')) {
            const [x, y] = elt.id.split('-').map(i => parseInt(i));
            if (x > 1 && y > 1) {
                return [x, y];
            }
        }
        throw "no open planet squares?";
    }

    static async findSettlingArmy(fleet: Fleet, planet: Planet): Promise<string> {
        const resp = await fetch(`/Military/OrbitalDropChoice?PlanetaryBodyId=${planet.uuid}&_=${Date.now()}`, { method: "GET", referrer: `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}` });
        const r = document.createRange().createContextualFragment(await resp.text());
        return to_list(r.querySelectorAll("#EmbarkedArmyList option:not([id=\"None\"])")).filter(o => o.textContent.match(/Settler/))[0].id;
    }

    static async settlePlanet(planet: Planet) {
        const fleet = await cmr.findSettlerFleet();
        const sq = cmr.findOpenNeighbor(planet.coords);
        console.log(`Moving fleet ${fleet} to ${sq}`);
        await cmr.moveFleet(fleet, sq);
        const armyId = await cmr.findSettlingArmy(fleet, planet);
        console.log(`Finding a spot to put army ${armyId} on ${planet}`);
        const openPlanetSquare = await cmr.findOpenPlanetSquare(planet);
        await cmr.drop(planet, armyId, openPlanetSquare);
        console.log(`Dropped army on ${openPlanetSquare}`);
        await cmr.buildLand(planet, openPlanetSquare, BuildingType.P, false);
        await cmr.embark(planet, armyId, fleet, openPlanetSquare);
        planet.dom_elt.style.borderColor = "blue";
        console.log(`Package delivered on ${planet.uuid}`)
    }

    static async spamFabs(planet: Planet) {
        return Promise.all(to_list((await planet.document).querySelectorAll<HTMLElement>('span.GalaxyMapButton div[id^="Resource_"]:empty')).map((e, _) => {
            const crd = e.id.split('_')[1].split('-').map(i => parseInt(i));
            return cmr.buildLand(planet, crd as [number, number], BuildingType.Fab, false)
        })).then(_ => console.log("Done spamming!"));
    }

    static async settleSystem() {
        let system = new System(cmr.systemId());
        let fleet = await cmr.findSettlerFleet();
        await cmr.buildSpace(system, fleet.last_known_coords, SpaceBuildingType.J, true);
        for (let star of cmr.detectStars()) {
            for (let open_slot of cmr.findOpenNeighbors(star)) {
                await cmr.buildSpace(system, open_slot, SpaceBuildingType.S, true)
            }
        }
        for (let planet of cmr.detectPlanets()) {
            await cmr.settlePlanet(planet);
            await cmr.spamFabs(planet);
        }
    }
}

interface Window {
    cmr: cmr;
}

window.cmr = cmr;