// ==UserScript==
// @name     PDO.SD4
// @version  1
// @grant    none
// ==/UserScript==

function to_list(l: NodeListOf<HTMLElement>): Array<HTMLElement> { let res: Array<HTMLElement> = []; l.forEach(e => res.push(e)); return res };
function toCoordString(n: number[]) : string {
    return n[0].toString() + '-' + n[1].toString();
}

declare function MapUpdate(data: any): void;

class Planet {
    uuid: string;
    coords: [number, number];
    constructor(uuid: string, coords: [number, number]) {
        this.uuid = uuid
        this.coords = coords
    }
}


enum BuildingType {
    Fab = "Resource Fabricator",
    P = "Orbital Elevator",
}

class cmr {
    
    constructor() {

    }

    // a planet is a [id as "x-y", uuid]
    // todo: typescript. id as coord pair, not string.
    static detectPlanets() : Array<Planet> {
        let detected_planets: Array<Planet> = [];
        document.querySelectorAll<HTMLElement>('.GalaxyMapButton').forEach((sq, _) => {
            if (sq.style.borderColor !== "blue") {
                const a = sq.children[0] as HTMLAnchorElement;
                if (!(!a || !a.href)) {
                    var match = a.href.match(/PlanetaryBody\/(.*)/)
                    if (match !== null) {
                        detected_planets.push(new Planet(sq.id, match[1].split('-').map(i => parseInt(i)) as [number, number]));
                    }
                }}});
        return detected_planets;
    }

    static findOpenNeighbor(planet: Planet): [number, number] {
        let [x, y] = planet.coords;
        const all_neighbors = [
            [x-1, y-1], [x, y-1], [x+1, y-1],
            [x-1, y],             [x+1, y],
            [x-1, y+1], [x, y+1], [x+1, y+1]];
        for (const n of all_neighbors) {
            const elt = document.querySelectorAll<HTMLElement>(`#${toCoordString(n)}:empty`)[0];
            if (elt) return n as [number, number];
        }
    }

    static findSettlerFleet() : Promise<string> {
        // TODO: call UpgradeFleet on each fleet icon in view, check if name is /Settler.*/?
        return Promise.resolve("950226a8-3755-4562-a6f1-75daf1283d13");
    }

    static systemId () : string {
        return document.querySelectorAll("#StarSystemId")[0].textContent;
    }

    static planetId() {
        return new Planet(document.querySelectorAll("#PlanetaryBodyId")[0].textContent, null);
    }

    static async moveFleet(fleet: string, dest: [number, number]) {
        // TODO: this finds the first fleet. how can we check it matches the one we're looking for?
        var fleet_sq = document.querySelectorAll('div.CanDragFleet')[0].id.split("_")[1].split("-").map(x => parseInt(x));
        if (fleet_sq === dest) { return Promise.resolve(null); }
        var fd = new URLSearchParams();
        fd.append('TargetLocation', toCoordString(dest));
        fd.append('SourceLocation', toCoordString(fleet_sq));
        fd.append('SystemId', cmr.systemId());
        const resp = await fetch('/War/MoveFleetToBody', {method: "POST", body: fd});
        const json = await resp.json();
        if (!json.Success) { console.error("oh no, moving fleet 'failed' :("); }
    }

    static async drop(planet: Planet, armyId: string, openSquare: [number, number]) {
        console.log(`Dropping on ${openSquare}`);
        var fd = new URLSearchParams();
        fd.append('BodyId', planet.uuid);
        fd.append('EmbarkedArmyId', armyId);
        fd.append('TargetLocation', toCoordString(openSquare));
        const resp = await fetch('/Military/OrbitallyDrop', {method: "POST", body: fd, referrer: `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}`});
        const json = await resp.json();
        // Success is a UI color field?
        // if (!json.Success) { console.error("oh no, dropping army failed :("); };
    }

    static async embark(planet: Planet, armyId: string, fleet: string, openSquare: [number, number]) {
        var fd = new URLSearchParams();
        fd.append('BodyId', planet.uuid);
        fd.append('FleetId', fleet);
        fd.append('TargetLocation', toCoordString(openSquare));
        const resp = await fetch('/Military/EmbarkOntoFleet', {method: "POST", body: fd, referrer: `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}`});
        const json = await resp.json();
        // Success is a UI color field?
        // if (!json.Success) { console.error("oh no, embarking army failed :("); }
    }

    static async build(planet: Planet, square: [number, number], building: BuildingType) {
        var fd = new URLSearchParams();
        fd.append('BodyId', planet.uuid);
        fd.append('BuildingType', building);
        fd.append('TargetLocation', toCoordString(square));
        const resp = await fetch('/Economy/BuildBuilding', {method: "POST", body: fd, referrer: `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}`});
        const json = await resp.json()
        MapUpdate(json);
        // Success is a UI color field?
        // if (!json.Success) { console.error(`oh no, building ${building} failed :(`); }
        }

    static async findOpenPlanetSquare(planet: Planet): Promise<[number, number]> {
        return new Promise<HTMLIFrameElement>(function (resolve, reject) {
            const pbody = document.createElement("iframe");
            window.addEventListener("message", e => { resolve(pbody); }, { once: true });
            pbody.addEventListener("error", e => { reject(); }, { once: true });
            document.body.appendChild(pbody);
            pbody.src = `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}`;
            console.log(pbody);
        }).then(pbody => {
            for (const elt of pbody.contentDocument.querySelectorAll('span.GalaxyMapButton:empty')) {
                console.log(`Examining ${elt} ${elt.id}`);
                console.log(elt);
                const [x, y] = elt.id.split('-').map(i => parseInt(i));
                if (x > 1 && y > 1) {
                    document.body.removeChild(pbody);
                    return [x, y];
                }
            }
            throw "no open planet squares?";
        })
    }

    static async findSettlingArmy(fleet: string, planet: Planet) : Promise<string> {
        const resp = await fetch(`/Military/OrbitalDropChoice?PlanetaryBodyId=${planet.uuid}&_=${Date.now()}`, {method: "GET", referrer: `https://sd4.arke.me/Map/PlanetaryBody/${planet.uuid}`});
        console.log("about to wait for a response from orbitaldropchoice...");
        const r = document.createRange().createContextualFragment(await resp.text());
        return to_list(r.querySelectorAll("#EmbarkedArmyList option:not([id=\"None\"])")).filter(o => o.textContent.match(/Settler/))[0].id;
    }

    static async settlePlanet(planet: Planet) {
        const fleet = await cmr.findSettlerFleet();
        const sq = cmr.findOpenNeighbor(planet);
        console.log(`Moving fleet ${fleet} to ${sq}`);
        await cmr.moveFleet(fleet, sq);
        const armyId = await cmr.findSettlingArmy(fleet, planet);
        console.log(`Finding a spot to put army ${armyId} on ${planet}`);
        const openPlanetSquare = await cmr.findOpenPlanetSquare(planet);
        await cmr.drop(planet, armyId, openPlanetSquare);
        console.log(`Dropped army on ${openPlanetSquare}`);
        await cmr.build(planet, openPlanetSquare, BuildingType.P);
        await cmr.embark(planet, armyId, fleet, openPlanetSquare);
    }

    static async spamFabs(planet: Planet) {
        return Promise.all(to_list(document.querySelectorAll<HTMLElement>('span.GalaxyMapButton div[id^="Resource_"]:empty')).map((e, _) => {
            const crd = e.id.split('_')[1].split('-').map(i => parseInt(i));
            return cmr.build(planet, crd as [number, number], BuildingType.Fab)
        })).then(_ => console.log("Done spamming!"));
    }
}