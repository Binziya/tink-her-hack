const QueueSense = {
    config: {
        keys: {
            PREFIX: 'qs_',
            DATA: 'qs_data_v4', // Version bump for new logic
            USER_SESSION: 'qs_user_session_v4'
        },
        defaults: {
            AVG_SERVICE_TIME: 10,
            BUFFER_TIME: 2
        },
        queueTypes: ['consultation', 'pharmacy', 'billing']
    },

    state: {
        doctors: [], // Array of doctor objects
        queues: {
            consultation: { current: 0, last: 0, list: [], history: [] },
            pharmacy: { current: 0, last: 0, list: [], history: [] },
            billing: { current: 0, last: 0, list: [], history: [] }
        }
    },

    init() {
        this.loadState();
    },

    loadState() {
        try {
            const raw = localStorage.getItem(this.config.keys.DATA);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    this.state = parsed;
                }
            }
        } catch (e) {
            console.error("QueueSense: Failed to parse state", e);
        }

        // Ensure structure
        if (!this.state.queues) this.state.queues = {};
        if (!this.state.doctors) this.state.doctors = [];

        ['consultation', 'pharmacy', 'billing'].forEach(type => {
            if (!this.state.queues[type]) {
                this.state.queues[type] = { current: 0, last: 0, list: [], history: [] };
            }
        });
    },

    saveState() {
        try {
            localStorage.setItem(this.config.keys.DATA, JSON.stringify(this.state));
        } catch (e) {
            console.error("QueueSense: Failed to save state", e);
        }
    },

    // --- Doctor Management ---

    addDoctor(doctorData) {
        this.loadState();
        const avgTime = parseInt(doctorData.avgTime) || this.config.defaults.AVG_SERVICE_TIME;
        const bufferTime = parseInt(doctorData.bufferTime) || 0;
        const totalStep = avgTime + bufferTime;

        let maxPatients = 0;
        if (doctorData.mode === 'count') {
            maxPatients = parseInt(doctorData.limit) || 0;
        } else if (doctorData.mode === 'time') {
            const startStr = doctorData.startTime;
            const endStr = doctorData.endTime;
            if (startStr && endStr) {
                const startMin = this.timeToMinutes(startStr);
                const endMin = this.timeToMinutes(endStr);
                const duration = endMin - startMin;
                if (duration > 0) {
                    maxPatients = Math.floor(duration / totalStep);
                }
            }
        }

        const newDoctor = {
            id: Date.now(),
            name: doctorData.name,
            sessionName: doctorData.sessionName || "",
            mode: doctorData.mode, // 'count' or 'time'
            maxPatients: maxPatients,
            startTime: doctorData.startTime || "09:00",
            endTime: doctorData.endTime || "17:00",
            avgTime: avgTime,
            bufferTime: bufferTime,
            active: true,
            patients: [],
            stats: {
                completed: 0,
                noShow: 0
            }
        };
        this.state.doctors.push(newDoctor);
        this.saveState();
        return newDoctor;
    },

    getDoctors() {
        this.loadState();
        return this.state.doctors.filter(d => d.active);
    },

    deleteDoctor(id) {
        this.loadState();
        this.state.doctors = this.state.doctors.filter(d => d.id !== id);
        this.saveState();
    },

    // --- Booking Logic ---

    bookToken(name, type, doctorId = null) {
        this.loadState();
        const qType = type.toLowerCase();
        let newToken = null;

        if (qType === 'consultation') {
            if (!doctorId) {
                const activeDocs = this.state.doctors.filter(d => d.active);
                if (activeDocs.length > 0) {
                    doctorId = activeDocs[0].id;
                }
            }

            if (!doctorId) return { error: "No active doctors available." };

            const doc = this.state.doctors.find(d => d.id == doctorId);
            if (!doc) return { error: "Doctor not found" };

            // Check if session is full (Completed + Allocated + Waiting)
            // Actually, the requirements say: "Patients can only book if the doctor has available slots for the current session."
            // But also: "Extra patients beyond max limit are placed in waiting list."
            // Let's assume there's a practical limit for the waiting list too, or check if we should allow unlimited waiting.
            // Requirement 3 says: "Once completed_count = doctor_max_patients, no further allocations are allowed for that session."
            // "When a patient books, check: if allocated_count + completed_count < doctor_max_patients: allocate patient else: waiting list"

            // Let's implement a "Total Capacity" check if desired, but requirements imply waiting list is for anything beyond active slots.
            // However, 7.3 says: "Booking after session full -> display 'Sorry, book next time'".
            // This implies a limit on the WHOLE session (Active + Waiting).
            // Let's set a waiting list cap or use common sense. 
            // If completed_count >= doctor_max_patients, then session is DONE.
            if (doc.stats.completed >= doc.maxPatients) {
                return { error: "Session completed. Sorry, book next time." };
            }

            // If we want to limit total bookings (Allocated + Waiting + Completed) to some multiple of maxPatients or fixed limit:
            const totalBooked = doc.patients.filter(p => p.status !== 'completed' && p.status !== 'no-show').length;
            const remainingToAllocate = doc.maxPatients - doc.stats.completed;

            // If total active + waiting >= something? 
            // The prompt says "If all slots are full (considering completed and allocated patients), display: 'Sorry, book next time.'"
            // But wait, it also says "Extra patients beyond max limit are placed in waiting list."
            // This is slightly contradictory. Usually, "Waiting List" means they might get a chance if someone cancels.
            // Let's allow a waiting list of size... say... 10% or 5 people.
            const waitingCount = doc.patients.filter(p => p.status === 'waiting').length;
            if (waitingCount >= 10) {
                return { error: "Waiting list is full. Sorry, book next time." };
            }

            const tokenId = doc.patients.length + 1;
            newToken = {
                id: tokenId,
                name: name,
                type: 'consultation',
                doctorId: doctorId,
                doctorName: doc.name,
                status: 'pending',
                bookingTime: Date.now()
            };

            doc.patients.push(newToken);
            this.recalculateDoctorQueue(doc.id);

        } else {
            // Generic Queue (Pharmacy/Billing)
            if (!this.state.queues[qType]) return { error: "Queue type invalid" };
            const q = this.state.queues[qType];
            q.last++;
            newToken = {
                id: q.last,
                name: name,
                type: qType,
                status: 'waiting',
                bookingTime: Date.now()
            };
            q.list.push(newToken);
        }

        this.saveState();

        if (newToken && !newToken.error) {
            const session = {
                token: newToken.id,
                name: name,
                type: qType,
                doctorId: doctorId
            };
            localStorage.setItem(this.config.keys.USER_SESSION, JSON.stringify(session));
        }

        return newToken;
    },

    // --- Core Logic for Allocated vs Waiting ---

    recalculateDoctorQueue(doctorId) {
        const doc = this.state.doctors.find(d => d.id == doctorId);
        if (!doc) return;

        const avgTime = doc.avgTime || 10;
        const buffer = doc.bufferTime || 0;
        const totalStep = avgTime + buffer;
        const maxLimit = doc.maxPatients;

        let completedCount = doc.patients.filter(p => p.status === 'completed').length;
        doc.stats.completed = completedCount;
        doc.stats.noShow = doc.patients.filter(p => p.status === 'no-show').length;

        // Allocation logic:
        // Only allocated_count <= doctor_max_patients - completed_count patients can be active at a time.
        const allowedAllocated = maxLimit - completedCount;
        let currentAllocatedCount = 0;

        // Sort patients by booking time to ensure sequence
        const activePatients = doc.patients.filter(p => p.status !== 'completed' && p.status !== 'no-show');

        activePatients.forEach((p, index) => {
            if (currentAllocatedCount < allowedAllocated) {
                p.status = 'allocated';
                // Arrival time calculation for allocated:
                // arrival_time = session_start_time + (position_in_allocated_list - 1) * average_consultation_time
                // Using current time as base or session start time. Let's use session start time if available.
                const startTimeMins = this.timeToMinutes(doc.startTime);
                // Position in ALLOCATED list (not global)
                const arrivalMins = startTimeMins + (currentAllocatedCount + completedCount) * totalStep;
                p.estimatedSlot = this.minutesToTime(arrivalMins);
                p.arrivalValue = arrivalMins;
                currentAllocatedCount++;
            } else {
                p.status = 'waiting';
                p.estimatedSlot = "Waiting List";
                p.arrivalValue = 999999;
            }
        });
    },

    markDoctorPatientCompleted(doctorId, tokenId) {
        this.loadState();
        const doc = this.state.doctors.find(d => d.id == doctorId);
        if (doc) {
            const p = doc.patients.find(t => t.id === tokenId);
            if (p) {
                p.status = 'completed';
                p.completedAt = Date.now();
                this.recalculateDoctorQueue(doctorId);
                this.saveState();
            }
        }
    },

    markDoctorPatientNoShow(doctorId, tokenId) {
        this.loadState();
        const doc = this.state.doctors.find(d => d.id == doctorId);
        if (doc) {
            const p = doc.patients.find(t => t.id === tokenId);
            if (p) {
                p.status = 'no-show';
                p.cancelledAt = Date.now();
                this.recalculateDoctorQueue(doctorId);
                this.saveState();
            }
        }
    },

    cancelDoctorPatient(doctorId, tokenId) {
        // User-initiated cancel
        this.markDoctorPatientNoShow(doctorId, tokenId);
    },

    leaveQueue(doctorId, tokenId) {
        this.markDoctorPatientNoShow(doctorId, tokenId);
        this.clearUserSession();
    },

    // --- Helpers ---

    timeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    },

    minutesToTime(mins) {
        let h = Math.floor(mins / 60) % 24;
        const m = Math.floor(mins % 60);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
    },

    getUserSession() {
        try {
            return JSON.parse(localStorage.getItem(this.config.keys.USER_SESSION));
        } catch (e) { return null; }
    },

    clearUserSession() {
        localStorage.removeItem(this.config.keys.USER_SESSION);
    },

    resetSystem() {
        localStorage.removeItem(this.config.keys.DATA);
        localStorage.removeItem(this.config.keys.USER_SESSION);
        this.state = {
            doctors: [],
            queues: {
                consultation: { current: 0, last: 0, list: [], history: [] },
                pharmacy: { current: 0, last: 0, list: [], history: [] },
                billing: { current: 0, last: 0, list: [], history: [] }
            }
        };
        this.saveState();
    },

    getQueueStats(type) {
        this.loadState();
        const q = this.state.queues[type] || { current: 0, last: 0, list: [] };
        return {
            ...q,
            waiting: q.list.filter(p => p.status === 'waiting').length
        };
    },

    incrementToken(type) {
        this.loadState();
        const q = this.state.queues[type];
        if (!q) return;

        if (q.current < q.last) {
            q.current++;
            const token = q.list.find(p => p.id === q.current);
            if (token) token.status = 'completed';
            this.saveState();
        }
    },

    getDoctorStats(doctorId) {
        this.loadState();
        const doc = this.state.doctors.find(d => d.id == doctorId);
        if (!doc) return null;

        return {
            name: doc.name,
            sessionName: doc.sessionName || "",
            maxPatients: doc.maxPatients,
            completed: doc.stats.completed,
            noShow: doc.stats.noShow,
            allocatedCount: doc.patients.filter(p => p.status === 'allocated').length,
            waitingCount: doc.patients.filter(p => p.status === 'waiting').length,
            list: doc.patients,
            mode: doc.mode,
            startTime: doc.startTime,
            avgTime: doc.avgTime,
            bufferTime: doc.bufferTime
        };
    }
};

window.QueueSense = QueueSense;
