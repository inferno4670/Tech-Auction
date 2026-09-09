-- ═══════════════════════════════════════════════════════════════════════════════
-- TECH AUCTION — Seed Data
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Event Settings ──────────────────────────────────────────────────────────

INSERT INTO event_settings (event_name, starting_budget, default_question_time, status, demo_mode, live_mode)
VALUES ('TECH AUCTION — National Level Quiz Competition', 1000, 20, 'setup', false, false);

-- ─── Auction Items ───────────────────────────────────────────────────────────

INSERT INTO auction_items (name, category, description, difficulty, starting_bid, minimum_increment, reward_points, penalty_points, question, correct_answer, sort_order, is_active)
VALUES
  (
    'SMART GRID',
    'Electrical Engineering',
    'Intelligent electrical grid that uses digital technology to monitor and manage electricity flow.',
    'intermediate',
    100,
    25,
    150,
    75,
    'What protocol suite is primarily used for communication between smart grid devices in a Advanced Metering Infrastructure (AMI)?',
    'IEEE 802.15.4g / ZigBee Smart Energy Profile',
    1,
    true
  ),
  (
    'LiDAR',
    'Remote Sensing',
    'Light Detection and Ranging — a remote sensing method that uses light in the form of a pulsed laser.',
    'intermediate',
    100,
    25,
    150,
    75,
    'What is the typical wavelength range used by terrestrial LiDAR systems operating in the near-infrared spectrum?',
    '905 nm or 1550 nm',
    2,
    true
  ),
  (
    'INTERNET OF THINGS',
    'Computer Networking',
    'A network of physical objects embedded with sensors and software for connecting and exchanging data.',
    'basic',
    50,
    10,
    75,
    25,
    'What is the lightweight messaging protocol specifically designed for IoT devices with limited bandwidth?',
    'MQTT (Message Queuing Telemetry Transport)',
    3,
    true
  ),
  (
    'MOSFET',
    'Electronics',
    'Metal-Oxide-Semiconductor Field-Effect Transistor — the most widely used semiconductor device.',
    'expert',
    200,
    50,
    250,
    150,
    'In the linear (triode) region of an NMOS transistor, what equation describes the drain current Id as a function of Vgs, Vth, Vds, and the process transconductance parameter kn?',
    'Id = kn[(Vgs - Vth)Vds - Vds²/2]',
    4,
    true
  ),
  (
    '5G NETWORKS',
    'Telecommunications',
    'Fifth generation wireless technology offering higher speeds, lower latency, and greater capacity.',
    'intermediate',
    100,
    25,
    150,
    75,
    'What is the name of the 5G core architecture that replaces the traditional EPC and uses a service-based architecture (SBA)?',
    '5GC (5G Core) with Service-Based Architecture',
    5,
    true
  ),
  (
    'EDGE COMPUTING',
    'Cloud Computing',
    'Processing data near the source of data generation rather than in a centralized cloud.',
    'basic',
    50,
    10,
    75,
    25,
    'What is the name of the open-source platform managed by the Linux Foundation that provides a framework for edge computing using Kubernetes?',
    'KubeEdge',
    6,
    true
  ),
  (
    'DIGITAL TWIN',
    'Simulation & Modeling',
    'A virtual replica of a physical entity that enables real-time simulation and monitoring.',
    'expert',
    200,
    50,
    250,
    150,
    'What NASA concept, first used for the Apollo 13 mission, is considered the precursor to modern digital twin technology?',
    'Living Digital Twin / Mission Simulation Model',
    7,
    true
  ),
  (
    'HVDC',
    'Power Systems',
    'High Voltage Direct Current — efficient transmission of large amounts of power over long distances.',
    'expert',
    200,
    50,
    250,
    150,
    'What type of converter is used at the receiving end of an HVDC transmission line to convert DC back to AC, and what is its key advantage over line-commutated converters?',
    'Voltage Source Converter (VSC) — can independently control active and reactive power and does not require a strong AC grid to operate',
    8,
    true
  ),
  (
    'EMBEDDED SYSTEMS',
    'Computer Engineering',
    'Specialized computing systems designed for specific control functions within larger systems.',
    'basic',
    50,
    10,
    75,
    25,
    'What is the name of the real-time operating system (RTOS) originally developed by Jean Labrosse that is widely used in embedded systems and is now open source?',
    'FreeRTOS (originally µC/OS-II was by Labrosse, but FreeRTOS by Barry is more widely used — accept either)',
    9,
    true
  ),
  (
    'QUANTUM COMPUTING',
    'Quantum Physics & Computing',
    'Computing that uses quantum-mechanical phenomena like superposition and entanglement.',
    'expert',
    200,
    50,
    250,
    150,
    'What is the name of the quantum error correction code that uses a 2D lattice of qubits and is considered the most promising for building fault-tolerant quantum computers?',
    'Surface Code (Toric Code variant)',
    10,
    true
  ),
  (
    'JACKPOT — NEURAL NETWORKS',
    'Artificial Intelligence',
    'Special JACKPOT round — all-in bidding! Neural networks inspired by biological brain structure.',
    'expert',
    200,
    50,
    300,
    200,
    'What is the name of the 2017 paper that introduced the Transformer architecture, which forms the basis of modern large language models like GPT?',
    '"Attention Is All You Need" by Vaswani et al.',
    11,
    true
  );
