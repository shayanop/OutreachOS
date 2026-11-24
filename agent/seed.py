import re

from psycopg import Connection

CITIES = ("Lahore", "Karachi", "Islamabad", "Dubai", "London")

# Each row in an industry corresponds to the city in the same position above.
DIRECTORY = {
    "dental clinic": (
        ("Canal Grove Dental", "Sana Qureshi", 9, "Books follow-ups by phone and has no online calendar."),
        ("Harbour Finch Dental", "Ali Noor", 14, "Three receptionists share an appointment spreadsheet."),
        ("Pine Court Dental", "Maha Mir", 7, "Sends cleaning reminders manually from a part-time desk."),
        ("Dune Iris Dental", "Layla Kareem", 22, "New patients wait overnight for WhatsApp replies."),
        ("Brook Fern Dentistry", "Nina Clarke", 13, "Has no waitlist to fill last-minute cancellations."),
    ),
    "gym": (
        ("Brick Orchard Fitness", "Omar Saeed", 12, "Records trial class sign-ups on paper at reception."),
        ("Tide Circuit Gym", "Zoya Khan", 18, "Has no follow-up sequence after complimentary trials."),
        ("Summit Lark Strength", "Bilal Amin", 8, "Loses visibility into expiring memberships on its shared sheet."),
        ("Quartz Palm Gym", "Hana Nasser", 28, "Runs three studios and tracks class capacity separately."),
        ("Cedar Lane Fitness", "Reece Hall", 16, "Manually reconciles new member inquiries across two inboxes."),
    ),
    "real-estate agency": (
        ("Maple Gate Realty", "Areeba Shah", 18, "Property viewing requests arrive in four agents' personal inboxes."),
        ("Saltwind Properties", "Hamza Rafi", 26, "Relies on manual reminders for buyer follow-ups after viewings."),
        ("Juniper Key Estates", "Fiza Malik", 11, "Has no consistent intake form for prospective tenants."),
        ("Banyan Door Realty", "Yusuf Salem", 32, "Assigns inquiries through a group chat with no ownership history."),
        ("Wren Yard Property", "Tara Hughes", 15, "Tracks its landlord prospect list in separate spreadsheets."),
    ),
    "restaurant": (
        ("Saffron Kite Kitchen", "Nadia Saleem", 24, "Takes large-party bookings by phone during service."),
        ("Coal and Bay Table", "Haris Tariq", 19, "Has no reminder process for catering quote follow-ups."),
        ("Little Alder Cafe", "Hira Abbasi", 10, "Uses social DMs for booking inquiries and replies after closing."),
        ("Fig Lantern Dining", "Amal Hassan", 37, "Private dining requests get mixed into the general inbox."),
        ("Copper Rain Bistro", "Theo Moore", 23, "Uses a handwritten waitlist during weekend dinner service."),
    ),
    "e-commerce store": (
        ("Fable Loom Goods", "Mina Arif", 12, "Manually answers order status questions from Instagram shoppers."),
        ("Paper Reef Market", "Arman Baig", 9, "Wholesale inquiries have no dedicated intake workflow."),
        ("Fern Parcel Shop", "Saba Iqbal", 8, "Returns requests are handled in a spreadsheet with no reminders."),
        ("Sand Glass Supply", "Dina Rashid", 20, "Abandoned checkout follow-ups are sent in one weekly batch."),
        ("Cotton Lark Studio", "Avery Green", 14, "Tracks trade partner outreach in two disconnected lists."),
    ),
    "SaaS startup": (
        ("Clover Relay", "Asad Latif", 15, "Trial users can request a demo but there is no automatic follow-up."),
        ("Beacon Pelican", "Saira Rizvi", 24, "Customer success and sales maintain separate lead lists."),
        ("Mint Harbor Labs", "Danish Aziz", 13, "Founders hand-sort inbound trial leads each morning."),
        ("Orchid Trail Cloud", "Farah Abbas", 30, "Pipeline handoffs after onboarding calls are in chat messages."),
        ("Signal Thicket", "Maya Ellis", 17, "No product-qualified lead stage for high-activity trial teams."),
    ),
}

TITLES = {
    "dental clinic": "Practice Manager",
    "gym": "Membership Manager",
    "real-estate agency": "Agency Director",
    "restaurant": "General Manager",
    "e-commerce store": "Operations Lead",
    "SaaS startup": "Growth Lead",
}


def run(conn: Connection) -> None:
    rows = []
    for industry, leads in DIRECTORY.items():
        for city, (company, contact, employees, notes) in zip(CITIES, leads, strict=True):
            slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-")
            domain = f"{slug}.example.com"
            email = f"{contact.split()[0].lower()}@{domain}"
            rows.append((company, industry, city, employees, f"https://{domain}",
                         contact, TITLES[industry], email, notes))
    with conn.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO leads (company, industry, city, employees, website, contact_name,
                               contact_title, contact_email, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )


if __name__ == "__main__":
    import db

    try:
        db.init()
        print(f"{len(db.admin_leads())} leads in the directory.")
    finally:
        db.close()
