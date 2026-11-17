# Freight-Flow Express — Parcel Logistics & Delivery Management System

**ITCC 14 (Integrative Programming) & ITCC 33 (Advanced Database Systems) — Final Project**

Freight-Flow Express is a parcel logistics web app for Cagayan de Oro: customers book a parcel and pay for it (1 booking : 1 payment), track it live, and file complaints; managers reconcile payments, dispatch couriers and run branches and staff; couriers advance parcel status; CSRs resolve complaints. The REST API follows [`docs/openapi.yaml`](docs/openapi.yaml).

## Team

| Member | Module |
| --- | --- |
| **Achilles A. Albacete** | Bookings & Payments |
| **Dwayne B. Delos Santos** | Parcels & Complaints |
| **Joshua** | Customers |
| **Harry Cinco** | Branches & Staff |

## Tech stack

- **Frontend:** HTML5, Tailwind CSS (Play CDN), Google Fonts (Inter, JetBrains Mono), Lucide icons, vanilla JavaScript (`frontend/js/api.js` shared runtime)
- **Backend:** Node.js 20+, Express 5, Mongoose 9
- **Database:** MongoDB
- **API contract:** OpenAPI 3.0.3 (`docs/openapi.yaml`)
- **Tests:** `node:test` against an in-memory MongoDB

## Folder structure

```
├── docs/
│   └── openapi.yaml          # Final OpenAPI 3.0.3 specification
├── frontend/                 # 9 pages served statically by Express
│   ├── index.html            # Login / register (Retail, E-Commerce, Non-Profit)
│   ├── profile.html          # Customer profile
│   ├── booking.html          # New booking + 1:1 payment + live tracker
│   ├── shipments.html        # My shipments, parcel drawer, report issue
│   ├── complaints.html       # Complaint desk (CSR / Manager) and my complaints (Customer)
│   ├── payments.html         # Manager payments ledger + void flow
│   ├── dashboard.html        # Manager dashboard + courier dispatch drawer
│   ├── admin-network.html    # Branches & staff CRUD
│   ├── courier.html          # Courier workspace (parcel status progression)
│   ├── css/ff.css            # Shared design system
│   └── js/api.js             # apiFetch, session/role switcher, toasts, nav shell
└── backend/
    ├── server.js             # Express app, MongoDB connection, static hosting, startup seed
    ├── seed.js               # Idempotent Cagayan de Oro sample data
    ├── models/index.js       # Mongoose schemas (polymorphic customers, 1:1 payments, ...)
    ├── routes/               # customers, branches, staff, bookings, payments, parcels, complaints, auth, dashboard
    ├── lib/                  # errors, validation, pagination, lifecycle rules, enrichment
    └── test/api.test.js      # Business-rule integration tests
```

> `BackendITCC33/`, `FrontendITCC14/`, `feature/`, the root `Freight-Flow … Frame N.html` mock-ups and the root `openapi.yaml` / `ITCC14API_FreightFlow_Final.yaml` are earlier per-member drafts kept for reference. They are not used by the app; `backend/` and `frontend/` supersede them.

## Run locally

Prerequisites: **Node.js 20+** and a **MongoDB** server listening on `mongodb://127.0.0.1:27017` (or set `MONGODB_URI`).

```bash
cd backend
npm install
npm start
```

Open **http://localhost:3000** — Express serves the frontend, so `index.html` loads directly. On first start the database `freight_flow` is seeded automatically (only into empty collections, so restarts never duplicate data).

| Command | What it does |
| --- | --- |
| `npm start` | Start the server on port 3000 (`PORT` env to change) |
| `npm run start:memory` | Same, but with a throwaway in-memory MongoDB — no MongoDB install needed (first run downloads a `mongod` binary, ~800 MB) |
| `npm run seed` / `npm run seed:reset` | Seed empty collections / wipe everything and reseed |
| `npm test` | Run the API business-rule tests |

Configuration (optional, see `backend/.env.example`): `PORT`, `MONGODB_URI`.

> If you previously ran the old `BackendITCC33` server, your local `freight_flow` database may hold documents in the old schema. Run `npm run seed:reset` to start clean.

## Using the app

The API is reachable at `/api`, `/api/v1` (the OpenAPI server URL) and as root aliases (`/customers`, `/bookings`, `/payments`, `/parcels`, `/branches`, `/staff`, `/complaints`).

The top-bar **Customer | Manager | Courier | CSR** switcher changes the active demo role and jumps to that role's page. You can also sign in from `index.html`:

| Role | Demo identity | Home page |
| --- | --- | --- |
| Customer | Maria Clara Santos (`maria.santos@email.com`, any password ≥ 6 chars) | `booking.html` |
| Manager | Rosalinda Uy (staff 1) | `payments.html` |
| Courier | Joshua Reyes (staff 5) | `courier.html` |
| CSR | Liza Macaraeg (staff 8) | `complaints.html` |

Other seeded logins: `juan.delacruz@email.com`, `ana.reyes@email.com`, `orders@kagayantech.ph` (E-Commerce), `logistics@mindanaorelief.org` (Non-Profit).

### Business rules enforced by the API

- **Payments are 1:1 with bookings.** A booking can hold only one active (`Paid`/`Pending`) payment — a second one returns `409`. A `Paid` payment moves the booking `Pending → Confirmed` and its parcels `Pending → Booked`.
- **Voiding** (`PATCH /payments/{id}/void`, `DELETE /payments/{id}`, or `payment_status: Voided`) sets the payment to `Voided`, reverts the booking to `Pending` and returns not-yet-collected parcels to `Pending`. A voided booking can be paid again with a new payment.
- **Parcel lifecycle** is sequential: `Pending → Booked → In Transit → Out for Delivery → Delivered` (or `Failed`, which can be retried via `In Transit`). Skipping a step, advancing an unpaid parcel, or touching a `Delivered` parcel returns `409`. Tracking numbers `FF-TRK-XXXXXX` are generated by the server.
- **Cancelling a booking** voids its payment and deletes its `Pending`/`Booked` parcels, but returns `409` once any parcel is `In Transit`, `Out for Delivery` or `Delivered`.
- **Deleting** a branch, staff member or customer that still has dependent records (staff, active bookings, active parcels, open complaints) returns `409` with an explanatory message.
- **Delivery team:** only staff with the `Courier` role can be assigned to a parcel (`422` otherwise); **complaints** can only be handled by a Customer Service Representative.
- Errors use the OpenAPI `Error` schema (`{ code, message, details[] }`) with `400/404/409/422` status codes.

### API extensions beyond the OpenAPI document

- `?include=details` on `/bookings`, `/payments`, `/parcels`, `/complaints` adds joined names/statuses so the UI avoids N+1 requests.
- Extra filters: `/parcels?customer_id=&staff_id=&search=`, `/payments?customer_id=`, `/complaints?customer_id=&parcel_id=`.
- `GET /dashboard` returns aggregate KPIs for the manager dashboard; `POST /auth/login` powers the login page; `contact_information` is accepted and returned as an alias of `contact_info`.

## Known limitations (demo build)

- **Authentication is demo-grade.** `POST /auth/login` finds a customer by email in `contact_info` and does not verify the password (the OpenAPI draft has no credential field), and the role switcher is client-side only. The API does not enforce the per-role permissions described in the OpenAPI document and has no JWT. Do not deploy publicly as-is.
- Cascades (payment → booking → parcels, booking cancellation) run as sequential writes, not a multi-document transaction, so they work on a standalone MongoDB.
