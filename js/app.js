// Main application logic
let currentUser = null;
let allTasks = [];
let filteredTasks = [];
let lastLoginDate = null;
let taskCompletionInProgress = new Set(); // Track tasks being processed to prevent duplicates
let isInitializing = false; // Track if we're in the initialization phase

// Button loading state helpers
function setButtonLoading(button, loading = true) {
    if (loading) {
        button.classList.add('loading');
        button.disabled = true;
        
        // Add spinner if not exists
        if (!button.querySelector('.spinner')) {
            const spinner = document.createElement('i');
            spinner.className = 'spinner';
            button.appendChild(spinner);
        }
    } else {
        button.classList.remove('loading');
        button.disabled = false;
        
        // Remove spinner
        const spinner = button.querySelector('.spinner');
        if (spinner) {
            spinner.remove();
        }
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthentication();
    await loadUserProfile();
    await loadTasks();
    
    initializeEventListeners();
    initializeViews();
    updateDashboardStats();
    
    // Check daily reminder after a short delay to ensure DOM is ready
    setTimeout(() => {
        checkDailyReminder();
    }, 500);
    
    // Ensure calendar is only visible in calendar view
    ensureCalendarHidden();
});

// Check if user is authenticated
async function checkAuthentication() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = user;
}

// Load user profile
async function loadUserProfile() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', currentUser.id)
            .single();

        if (error && error.code === 'PGRST116') {
            // Profile doesn't exist (Google OAuth user) - create it
            const fullName = currentUser.user_metadata?.full_name || 
                            currentUser.user_metadata?.name || 
                            currentUser.email?.split('@')[0] || 
                            'User';
            
            const { error: insertError } = await supabase
                .from('profiles')
                .insert([{ id: currentUser.id, full_name: fullName }]);

            if (insertError) {
                console.error('Error creating profile:', insertError);
            }

            document.getElementById('userName').textContent = fullName;
        } else if (error) {
            console.error('Error loading profile:', error);
            // Fallback to email or metadata
            const fallbackName = currentUser.user_metadata?.full_name || 
                                currentUser.user_metadata?.name || 
                                currentUser.email?.split('@')[0] || 
                                'User';
            document.getElementById('userName').textContent = fallbackName;
        } else if (data) {
            document.getElementById('userName').textContent = data.full_name || 'User';
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// Load all tasks
async function loadTasks() {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('order_index', { ascending: true });

        if (error) throw error;

        allTasks = data || [];
        // Instead of directly setting filteredTasks, apply filters to preserve search state
        // This ensures that search and other filters are maintained after actions
        applyFilters();
        updateDashboardStats();
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

// Render tasks in the tasks view
function renderTasks() {
    const tasksList = document.getElementById('tasksList');
    // Only render if tasks view is active and tasksList element exists
    if (!tasksList) {
        return; // Tasks view is not active, skip rendering
    }
    
    const activeTasks = filteredTasks.filter(task => !task.archived);

    if (activeTasks.length === 0) {
        tasksList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>No tasks found</h3>
                <p>Create your first task to get started!</p>
            </div>
        `;
        // Disable drag and drop when no tasks
        if (tasksList.sortableInstance) {
            tasksList.sortableInstance.destroy();
            tasksList.sortableInstance = null;
        }
        return;
    }

    tasksList.innerHTML = activeTasks.map(task => createTaskHTML(task)).join('');
    attachTaskEventListeners();
    
    // Initialize drag and drop for all tasks
    setTimeout(() => initializeDragDrop(), 100);
}

// Create task HTML
function createTaskHTML(task) {
    const deadline = new Date(task.deadline);
    const isOverdue = deadline < new Date() && !task.completed;
    const deadlineText = formatDate(deadline);
    
    return `
        <div class="task-item priority-${task.priority} ${task.completed ? 'completed' : ''}" 
             data-task-id="${task.id}">
            <div class="task-header">
                <input type="checkbox" class="task-checkbox" 
                       ${task.completed ? 'checked' : ''} 
                       onchange="toggleTaskComplete('${task.id}')">
                <div class="task-content">
                    <div class="task-title">${escapeHtml(task.title)}</div>
                    ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
                    <div class="task-meta">
                        <span class="task-badge badge-deadline ${isOverdue ? 'overdue' : ''}">
                            <i class="fas fa-calendar"></i>
                            ${deadlineText}
                        </span>
                        <span class="task-badge badge-category">
                            <i class="fas fa-folder"></i>
                            ${capitalizeFirst(task.category)}
                        </span>
                        <span class="task-badge badge-priority ${task.priority}">
                            <i class="fas fa-flag"></i>
                            ${capitalizeFirst(task.priority)}
                        </span>
                        ${task.recurring !== 'none' ? `
                            <span class="task-badge badge-recurring">
                                <i class="fas fa-repeat"></i>
                                ${capitalizeFirst(task.recurring)}
                            </span>
                        ` : ''}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn-icon edit" onclick="editTask('${task.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon archive" onclick="archiveTask('${task.id}', event)">
                        <i class="fas fa-archive"></i>
                    </button>
                    <button class="btn-icon delete" onclick="deleteTask('${task.id}', event)">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Initialize event listeners
function initializeEventListeners() {
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Mobile menu toggle
    const menuToggle = document.getElementById('menuToggle');
    const closeSidebarBtn = document.getElementById('closeSidebar');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    function openSidebar() {
        sidebar.classList.add('active');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
        if (window.innerWidth <= 768) {
            document.body.classList.add('sidebar-open');
        }
    }
    
    function closeSidebar() {
        sidebar.classList.remove('active');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
    }
    
    if (menuToggle) {
        menuToggle.addEventListener('click', openSidebar);
    }
    
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', closeSidebar);
    }
    
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }
    
    // Close sidebar when clicking nav items on mobile
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                setTimeout(closeSidebar, 100);
            }
        });
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeSidebar();
        }
    });

    // Add task button
    document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal());

    // Task form submission
    document.getElementById('taskForm').addEventListener('submit', saveTask);

    // Cancel task
    document.getElementById('cancelTask').addEventListener('click', closeTaskModal);

    // Close modal buttons
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').classList.remove('active');
        });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', handleSearch);

    // Filters
    document.getElementById('filterCategory').addEventListener('change', applyFilters);
    document.getElementById('filterPriority').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterDate').addEventListener('change', applyFilters);

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            switchView(view, true); // Update hash when clicking nav items
        });
    });
    
    // Handle hash changes (when URL hash changes - either from clicks or browser back/forward)
    window.addEventListener('hashchange', () => {
        // Skip hashchange handling during initialization to avoid double loading
        if (isInitializing) {
            return;
        }
        const hash = window.location.hash.substring(1); // Remove the # symbol
        const validViews = ['dashboard', 'tasks', 'calendar', 'archive'];
        const viewName = validViews.includes(hash) ? hash : 'dashboard';
        switchView(viewName, false); // Don't update hash again to avoid loop
    });
}

// Initialize views
function initializeViews() {
    isInitializing = true; // Set flag to prevent hashchange from handling during init
    
    // Check if there's a hash in the URL, otherwise default to dashboard
    const hash = window.location.hash.substring(1); // Remove the # symbol
    const validViews = ['dashboard', 'tasks', 'calendar', 'archive'];
    let viewName = validViews.includes(hash) ? hash : 'dashboard';
    
    // Set the hash if it's not already set (for initial load)
    if (!hash || !validViews.includes(hash)) {
        // Update URL hash to reflect the view
        // This will trigger hashchange, but we'll ignore it because isInitializing is true
        window.location.hash = viewName;
    }
    
    // Switch to the view (don't update hash again to avoid triggering hashchange)
    // This ensures the view loads immediately
    switchView(viewName, false);
    
    // Reset flag after a short delay to allow hashchange to work normally
    setTimeout(() => {
        isInitializing = false;
    }, 100);
}

// Ensure calendar elements are hidden from non-calendar views
function ensureCalendarHidden() {
    const calendarView = document.getElementById('calendarView');
    if (calendarView && !calendarView.classList.contains('active')) {
        calendarView.style.display = 'none';
    }
}

// Switch between views
function switchView(viewName, updateHash = true) {
    // Update URL hash to reflect current view (unless we're called from hashchange event)
    if (updateHash && window.location.hash !== `#${viewName}`) {
        window.location.hash = viewName;
        return; // hashchange event will handle the actual view switch
    }

    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const navItem = document.querySelector(`[data-view="${viewName}"]`);
    if (navItem) {
        navItem.classList.add('active');
    }

    // Update views - explicitly hide/show to prevent overlap
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
        view.style.display = 'none';
    });
    
    const targetView = document.getElementById(`${viewName}View`);
    if (targetView) {
        targetView.classList.add('active');
        targetView.style.display = 'block';
    }

    // Load specific view data
    if (viewName === 'tasks') {
        renderTasks();
    } else if (viewName === 'calendar') {
        renderCalendar();
    } else if (viewName === 'archive') {
        loadArchivedTasks();
    } else if (viewName === 'dashboard') {
        updateDashboardStats();
        renderDashboardChart();
    }
}

// Load archived tasks
async function loadArchivedTasks() {
    await loadTasks(); // Refresh all tasks
    renderArchivedTasks();
}

// Open task modal
function openTaskModal(taskId = null) {
    const modal = document.getElementById('taskModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('taskForm');
    
    form.reset();
    document.getElementById('taskId').value = '';

    if (taskId) {
        // Edit mode
        const task = allTasks.find(t => t.id === taskId);
        if (task) {
            modalTitle.textContent = 'Edit Task';
            document.getElementById('taskId').value = task.id;
            document.getElementById('taskTitle').value = task.title;
            document.getElementById('taskDescription').value = task.description || '';
            document.getElementById('taskDeadline').value = formatDateForInput(task.deadline);
            document.getElementById('taskPriority').value = task.priority;
            document.getElementById('taskCategory').value = task.category;
            document.getElementById('taskRecurring').value = task.recurring || 'none';
        }
    } else {
        // Add mode
        modalTitle.textContent = 'Add New Task';
        // Set default deadline to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('taskDeadline').value = formatDateForInput(tomorrow.toISOString());
        // Ensure recurring is set to 'none' by default
        document.getElementById('taskRecurring').value = 'none';
    }

    modal.classList.add('active');
}

// Close task modal
function closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
}

// Save task
async function saveTask(e) {
    e.preventDefault();

    const taskId = document.getElementById('taskId').value;
    const taskData = {
        title: document.getElementById('taskTitle').value,
        description: document.getElementById('taskDescription').value,
        deadline: document.getElementById('taskDeadline').value,
        priority: document.getElementById('taskPriority').value,
        category: document.getElementById('taskCategory').value,
        recurring: document.getElementById('taskRecurring').value || 'none',
        user_id: currentUser.id
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true);

    try {
        if (taskId) {
            // Update existing task
            const { error } = await supabase
                .from('tasks')
                .update(taskData)
                .eq('id', taskId);

            if (error) throw error;
        } else {
            // Create new task
            const { error } = await supabase
                .from('tasks')
                .insert([{ ...taskData, order_index: allTasks.length }]);

            if (error) throw error;
        }

        closeTaskModal();
        await loadTasks();
        // Refresh dashboard chart if on dashboard view
        if (document.getElementById('dashboardView').classList.contains('active')) {
            renderDashboardChart();
        }
        showNotification(taskId ? 'Task updated successfully!' : 'Task created successfully!', 'success');
    } catch (error) {
        console.error('Error saving task:', error);
        showNotification('Error saving task: ' + error.message, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

// Edit task
function editTask(taskId) {
    openTaskModal(taskId);
}

// Toggle task complete
async function toggleTaskComplete(taskId) {
    // Prevent multiple simultaneous calls for the same task
    if (taskCompletionInProgress.has(taskId)) {
        console.log('Task completion already in progress for task:', taskId);
        return;
    }
    
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    // Add to processing set
    taskCompletionInProgress.add(taskId);
    
    // Disable the checkbox to prevent multiple clicks
    // Find checkbox by finding the task item first, then its checkbox
    const taskItem = document.querySelector(`[data-task-id="${taskId}"]`);
    const checkbox = taskItem ? taskItem.querySelector('input[type="checkbox"].task-checkbox') : null;
    if (checkbox) {
        checkbox.disabled = true;
        checkbox.style.pointerEvents = 'none'; // Also disable pointer events
    }

    try {
        const newCompletedStatus = !task.completed;
        const wasPreviouslyCompleted = task.completed;
        
        // Only proceed if task is being marked as complete (not uncomplete)
        // and if it wasn't already completed
        if (!newCompletedStatus || wasPreviouslyCompleted) {
            // Just update the status, no recurring task creation needed
            const { error } = await supabase
                .from('tasks')
                .update({ completed: newCompletedStatus })
                .eq('id', taskId);

            if (error) throw error;
            
            await loadTasks();
            showNotification(newCompletedStatus ? 'Task completed!' : 'Task marked as incomplete', 'success');
            return;
        }
        
        // Update task to completed first
        const { error } = await supabase
            .from('tasks')
            .update({ completed: true })
            .eq('id', taskId);

        if (error) throw error;

        // Handle recurring tasks - only create when transitioning from incomplete to complete
        // and only if explicitly set to daily, weekly, or monthly
        if (task.recurring && ['daily', 'weekly', 'monthly'].includes(task.recurring)) {
            // IMPORTANT: Only create recurring task ONCE per completion
            // Check if this task was recently created (within last 2 minutes) to avoid creating recurring tasks 
            // for tasks that were themselves just created as recurring tasks
            const taskCreatedAt = new Date(task.created_at || new Date());
            const now = new Date();
            const timeSinceCreation = now - taskCreatedAt;
            const twoMinutesAgo = 2 * 60 * 1000; // 2 minutes in milliseconds
            
            // Only create recurring task if:
            // 1. The original task is not too new (to avoid cascading creation from newly created recurring tasks)
            // 2. No incomplete recurring task with the same title/type already exists
            if (timeSinceCreation > twoMinutesAgo) {
                // Create recurring task with additional safeguards
                await createRecurringTask(task);
            } else {
                console.log('Task was recently created (within 2 minutes), skipping recurring task creation to prevent cascade. Task age:', Math.round(timeSinceCreation / 1000), 'seconds');
            }
        }

        // Note: Notification will be shown by createRecurringTask if a recurring task is created
        // Otherwise, we'll show a simple completion notification
        const recurringTaskWillBeCreated = task.recurring && ['daily', 'weekly', 'monthly'].includes(task.recurring) && 
                                           (task.created_at && (new Date() - new Date(task.created_at)) > 2 * 60 * 1000);
        
        await loadTasks();
        // Refresh dashboard chart if on dashboard view
        if (document.getElementById('dashboardView').classList.contains('active')) {
            renderDashboardChart();
        }
        
        // Only show simple notification if recurring task creation was skipped
        // (The createRecurringTask function will show its own notification if successful)
        if (!recurringTaskWillBeCreated) {
            showNotification('Task completed!', 'success');
        }
    } catch (error) {
        console.error('Error toggling task:', error);
        showNotification('Error updating task', 'error');
    } finally {
        // Remove from processing set and re-enable checkbox
        taskCompletionInProgress.delete(taskId);
        if (checkbox) {
            checkbox.disabled = false;
            // Reload tasks will update the checkbox state automatically
        }
    }
}

// Create recurring task
async function createRecurringTask(originalTask) {
    console.log('Creating recurring task for:', originalTask.title, 'with recurring:', originalTask.recurring);
    
    const deadline = new Date(originalTask.deadline);
    
    switch (originalTask.recurring) {
        case 'daily':
            deadline.setDate(deadline.getDate() + 1);
            break;
        case 'weekly':
            deadline.setDate(deadline.getDate() + 7);
            break;
        case 'monthly':
            deadline.setMonth(deadline.getMonth() + 1);
            break;
        default:
            console.log('Invalid recurring type:', originalTask.recurring);
            return;
    }

    // Normalize deadline to start of day for comparison
    const nextDeadlineStart = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    nextDeadlineStart.setHours(0, 0, 0, 0);
    const nextDeadlineEnd = new Date(nextDeadlineStart);
    nextDeadlineEnd.setDate(nextDeadlineEnd.getDate() + 1);
    
    try {
        // CRITICAL: Check for ANY incomplete recurring task with the same title and recurring type
        // This is the most important check - if ANY incomplete recurring task exists for this title/type,
        // we should NOT create a new one, regardless of deadline date
        const { data: existingIncompleteTasks, error: incompleteQueryError } = await supabase
            .from('tasks')
            .select('id, deadline, created_at')
            .eq('user_id', currentUser.id)
            .eq('title', originalTask.title)
            .eq('recurring', originalTask.recurring)
            .eq('archived', false)
            .eq('completed', false)
            .limit(1);
        
        if (incompleteQueryError) {
            console.error('Error checking for existing incomplete recurring task:', incompleteQueryError);
            // Don't create if we can't check - better safe than sorry
            return;
        }
        
        // If ANY incomplete recurring task exists for this title/type, don't create a new one
        if (existingIncompleteTasks && existingIncompleteTasks.length > 0) {
            console.log('Found existing incomplete recurring task - skipping creation. Existing task deadline:', existingIncompleteTasks[0].deadline);
            return;
        }
        
        // Additional safety check: Look for recently created tasks (within last 2 minutes) with same title/type
        // This catches rapid duplicate creation attempts from multiple clicks
        const now = new Date();
        const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
        
        const { data: recentTasks, error: recentQueryError } = await supabase
            .from('tasks')
            .select('id, deadline, created_at')
            .eq('user_id', currentUser.id)
            .eq('title', originalTask.title)
            .eq('recurring', originalTask.recurring)
            .eq('archived', false)
            .gte('created_at', twoMinutesAgo.toISOString())
            .limit(5);
        
        if (recentQueryError) {
            console.error('Error checking for recent recurring tasks:', recentQueryError);
            // Continue anyway - the incomplete check above is more important
        } else if (recentTasks && recentTasks.length > 0) {
            // Check if any of the recent tasks have a deadline on or after our target deadline
            for (const recentTask of recentTasks) {
                const recentDeadline = new Date(recentTask.deadline);
                if (recentDeadline >= nextDeadlineStart) {
                    console.log('Found recently created recurring task with deadline:', recentDeadline, '- skipping creation');
                    return;
                }
            }
        }
        
        console.log('No duplicate found, creating new recurring task with deadline:', nextDeadlineStart);
    } catch (error) {
        console.error('Error checking for existing recurring task:', error);
        // Don't create if check fails - better safe than sorry
        return;
    }

    const newTask = {
        user_id: currentUser.id,
        title: originalTask.title,
        description: originalTask.description || '',
        deadline: deadline.toISOString(),
        priority: originalTask.priority,
        category: originalTask.category,
        recurring: originalTask.recurring,
        completed: false,
        archived: false,
        order_index: allTasks.filter(t => !t.archived).length
    };

    try {
        const { error } = await supabase
            .from('tasks')
            .insert([newTask]);

        if (error) {
            console.error('Error creating recurring task:', error);
            // Don't throw - we've already marked the original task as complete
            return;
        }
        
        console.log('Successfully created recurring task:', newTask.title, 'with deadline:', deadline.toISOString());
        // Show notification that recurring task was created
        showNotification(`Task completed! New ${originalTask.recurring} task created.`, 'success');
    } catch (error) {
        console.error('Error creating recurring task:', error);
        // Don't throw - we've already marked the original task as complete
    }
}

// Archive task
async function archiveTask(taskId, event) {
    if (!confirm('Are you sure you want to archive this task?')) return;

    // Find the button that triggered this
    const button = event ? event.target.closest('button') : null;
    if (button) setButtonLoading(button, true);

    try {
        const { error } = await supabase
            .from('tasks')
            .update({ archived: true })
            .eq('id', taskId);

        if (error) throw error;

        await loadTasks();
        // Refresh dashboard chart if on dashboard view
        if (document.getElementById('dashboardView').classList.contains('active')) {
            renderDashboardChart();
        }
        showNotification('Task archived successfully!', 'success');
    } catch (error) {
        console.error('Error archiving task:', error);
        showNotification('Error archiving task', 'error');
    } finally {
        if (button) setButtonLoading(button, false);
    }
}

// Delete task
async function deleteTask(taskId, event) {
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) return;

    // Find the button that triggered this
    const button = event ? event.target.closest('button') : null;
    if (button) setButtonLoading(button, true);

    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', taskId);

        if (error) throw error;

        await loadTasks();
        // Refresh dashboard chart if on dashboard view
        if (document.getElementById('dashboardView').classList.contains('active')) {
            renderDashboardChart();
        }
        showNotification('Task deleted successfully!', 'success');
    } catch (error) {
        console.error('Error deleting task:', error);
        showNotification('Error deleting task', 'error');
    } finally {
        if (button) setButtonLoading(button, false);
    }
}

// Render archived tasks
function renderArchivedTasks() {
    const archiveList = document.getElementById('archiveList');
    const archivedTasks = allTasks.filter(task => task.archived);

    if (archivedTasks.length === 0) {
        archiveList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-archive"></i>
                <h3>No archived tasks</h3>
                <p>Completed tasks you archive will appear here.</p>
            </div>
        `;
        // Disable drag and drop when no tasks
        if (archiveList.sortableInstance) {
            archiveList.sortableInstance.destroy();
            archiveList.sortableInstance = null;
        }
        return;
    }

    archiveList.innerHTML = archivedTasks.map(task => createArchivedTaskHTML(task)).join('');
    
    // Initialize drag and drop for archived tasks
    setTimeout(() => initializeArchiveDragDrop(), 100);
}

// Create archived task HTML
function createArchivedTaskHTML(task) {
    const deadline = new Date(task.deadline);
    const deadlineText = formatDate(deadline);
    
    return `
        <div class="task-item priority-${task.priority} completed" data-task-id="${task.id}">
            <div class="task-header">
                <div class="task-content" style="flex: 1;">
                    <div class="task-title">${escapeHtml(task.title)}</div>
                    ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
                    <div class="task-meta">
                        <span class="task-badge badge-deadline">
                            <i class="fas fa-calendar"></i>
                            ${deadlineText}
                        </span>
                        <span class="task-badge badge-category">
                            <i class="fas fa-folder"></i>
                            ${capitalizeFirst(task.category)}
                        </span>
                        <span class="task-badge badge-priority ${task.priority}">
                            <i class="fas fa-flag"></i>
                            ${capitalizeFirst(task.priority)}
                        </span>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn-icon" onclick="unarchiveTask('${task.id}', event)" title="Unarchive">
                        <i class="fas fa-undo"></i>
                    </button>
                    <button class="btn-icon delete" onclick="deleteTask('${task.id}', event)">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Unarchive task
async function unarchiveTask(taskId, event) {
    // Find the button that triggered this
    const button = event ? event.target.closest('button') : null;
    if (button) setButtonLoading(button, true);

    try {
        const { error } = await supabase
            .from('tasks')
            .update({ archived: false })
            .eq('id', taskId);

        if (error) throw error;

        await loadTasks();
        renderArchivedTasks();
        showNotification('Task restored successfully!', 'success');
    } catch (error) {
        console.error('Error unarchiving task:', error);
        showNotification('Error restoring task', 'error');
    } finally {
        if (button) setButtonLoading(button, false);
    }
}

// Handle search
function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    
    if (searchTerm === '') {
        filteredTasks = allTasks.filter(task => !task.archived);
    } else {
        filteredTasks = allTasks.filter(task => 
            !task.archived &&
            (task.title.toLowerCase().includes(searchTerm) ||
             (task.description && task.description.toLowerCase().includes(searchTerm)))
        );
    }
    
    applyFilters();
}

// Apply filters
function applyFilters() {
    // Safely get filter values - elements might not exist if not on tasks view
    const categoryEl = document.getElementById('filterCategory');
    const priorityEl = document.getElementById('filterPriority');
    const statusEl = document.getElementById('filterStatus');
    const filterDateEl = document.getElementById('filterDate');
    const searchInputEl = document.getElementById('searchInput');
    
    const category = categoryEl ? categoryEl.value : 'all';
    const priority = priorityEl ? priorityEl.value : 'all';
    const status = statusEl ? statusEl.value : 'all';
    const filterDate = filterDateEl ? filterDateEl.value : '';
    const searchTerm = searchInputEl ? searchInputEl.value.toLowerCase() : '';

    filteredTasks = allTasks.filter(task => {
        // Search filter
        const matchesSearch = searchTerm === '' || 
            task.title.toLowerCase().includes(searchTerm) ||
            (task.description && task.description.toLowerCase().includes(searchTerm));

        // Category filter
        const matchesCategory = category === 'all' || task.category === category;

        // Priority filter
        const matchesPriority = priority === 'all' || task.priority === priority;

        // Status filter
        let matchesStatus = true;
        if (status === 'active') {
            matchesStatus = !task.completed && !task.archived;
        } else if (status === 'completed') {
            matchesStatus = task.completed && !task.archived;
        } else {
            matchesStatus = !task.archived;
        }

        // Date filter
        let matchesDate = true;
        if (filterDate) {
            const selectedDate = new Date(filterDate);
            const dateStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const dateEnd = new Date(dateStart);
            dateEnd.setDate(dateEnd.getDate() + 1);
            
            const taskDate = new Date(task.deadline);
            const taskDay = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
            
            // Check if task deadline matches the selected date
            matchesDate = taskDay >= dateStart && taskDay < dateEnd;
            
            // Also check for recurring tasks if they match the date
            if (!matchesDate && task.recurring && ['daily', 'weekly', 'monthly'].includes(task.recurring)) {
                matchesDate = isRecurringTaskOnDate(task, selectedDate);
            }
        }

        return matchesSearch && matchesCategory && matchesPriority && matchesStatus && matchesDate;
    });

    renderTasks();
}

// Attach task event listeners
function attachTaskEventListeners() {
    // Already handled via onclick attributes in HTML for simplicity
}

// Update dashboard stats
function updateDashboardStats() {
    const activeTasks = allTasks.filter(task => !task.archived);
    const completedTasks = activeTasks.filter(task => task.completed);
    const pendingTasks = activeTasks.filter(task => !task.completed);
    
    // Calculate overdue and today tasks, including recurring tasks
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const overdueTasks = pendingTasks.filter(task => {
        const taskDeadline = new Date(task.deadline);
        const taskDay = new Date(taskDeadline.getFullYear(), taskDeadline.getMonth(), taskDeadline.getDate());
        
        // Check if task is overdue based on its deadline
        if (taskDay < today) {
            // For recurring tasks, check if today is a recurring occurrence
            // If today is a recurring occurrence, the task is not overdue (it's due today)
            if (task.recurring && ['daily', 'weekly', 'monthly'].includes(task.recurring)) {
                // If today is a recurring occurrence, task is due today, not overdue
                if (isRecurringTaskOnDate(task, today)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    });
    
    const todayTasks = pendingTasks.filter(task => {
        const taskDeadline = new Date(task.deadline);
        const taskDay = new Date(taskDeadline.getFullYear(), taskDeadline.getMonth(), taskDeadline.getDate());
        
        // Check if task deadline is today
        if (taskDay.getTime() === today.getTime()) {
            return true;
        }
        
        // Check if this is a recurring task that occurs today
        if (task.recurring && ['daily', 'weekly', 'monthly'].includes(task.recurring)) {
            return isRecurringTaskOnDate(task, today);
        }
        
        return false;
    });

    document.getElementById('completedCount').textContent = completedTasks.length;
    document.getElementById('pendingCount').textContent = pendingTasks.length;
    document.getElementById('overdueCount').textContent = overdueTasks.length;
    document.getElementById('todayCount').textContent = todayTasks.length;
}

// Render dashboard chart
function renderDashboardChart() {
    const activeTasks = allTasks.filter(task => !task.archived);
    
    // Render all charts
    renderCategoryChart(activeTasks);
    renderPriorityChart(activeTasks);
    renderStatusChart(activeTasks);
    renderMonthlyProgressChart(activeTasks);
}

// Render category chart
function renderCategoryChart(activeTasks) {
    const ctx = document.getElementById('taskCategoryChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (window.categoryChartInstance) {
        window.categoryChartInstance.destroy();
    }

    // Count tasks by category
    const categories = {};
    activeTasks.forEach(task => {
        categories[task.category] = (categories[task.category] || 0) + 1;
    });

    window.categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categories).map(cat => capitalizeFirst(cat)),
            datasets: [{
                label: 'Tasks',
                data: Object.values(categories),
                backgroundColor: [
                    '#6366f1',
                    '#8b5cf6',
                    '#10b981',
                    '#f59e0b',
                    '#ef4444'
                ],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 10,
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

// Render priority chart
function renderPriorityChart(activeTasks) {
    const ctx = document.getElementById('taskPriorityChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (window.priorityChartInstance) {
        window.priorityChartInstance.destroy();
    }

    // Count tasks by priority
    const priorities = { high: 0, medium: 0, low: 0 };
    activeTasks.forEach(task => {
        priorities[task.priority] = (priorities[task.priority] || 0) + 1;
    });

    window.priorityChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['High', 'Medium', 'Low'],
            datasets: [{
                label: 'Number of Tasks',
                data: [priorities.high, priorities.medium, priorities.low],
                backgroundColor: [
                    '#ef4444',
                    '#f59e0b',
                    '#10b981'
                ],
                borderWidth: 0,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

// Render status chart
function renderStatusChart(activeTasks) {
    const ctx = document.getElementById('taskStatusChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (window.statusChartInstance) {
        window.statusChartInstance.destroy();
    }

    const completed = activeTasks.filter(task => task.completed).length;
    const pending = activeTasks.filter(task => !task.completed).length;
    const total = activeTasks.length;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

    window.statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Completed', 'Pending'],
            datasets: [{
                label: 'Tasks',
                data: [completed, pending],
                backgroundColor: [
                    '#10b981',
                    '#f59e0b'
                ],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 10,
                        font: {
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Render monthly progress chart
function renderMonthlyProgressChart(activeTasks) {
    const ctx = document.getElementById('monthlyProgressChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (window.monthlyChartInstance) {
        window.monthlyChartInstance.destroy();
    }

    // Get current date and calculate start of month
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const labels = [];
    const completedData = [];
    const createdData = [];

    // Generate data for each day of the current month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth, day);
        date.setHours(0, 0, 0, 0);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        
        // Day label (show every 3rd day to avoid crowding)
        if (day === 1 || day % 3 === 0 || day === daysInMonth) {
            labels.push(day.toString());
        } else {
            labels.push('');
        }

        // Count completed tasks on this day
        const completedOnDay = allTasks.filter(task => {
            if (!task.completed) return false;
            const updatedDate = new Date(task.updated_at || task.created_at);
            return updatedDate >= date && updatedDate < nextDate;
        }).length;
        completedData.push(completedOnDay);

        // Count created tasks on this day
        const createdOnDay = allTasks.filter(task => {
            const createdDate = new Date(task.created_at);
            return createdDate >= date && createdDate < nextDate;
        }).length;
        createdData.push(createdOnDay);
    }

    const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    window.monthlyChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Tasks Completed',
                    data: completedData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Tasks Created',
                    data: createdData,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12,
                            weight: '500'
                        },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                title: {
                    display: true,
                    text: monthName,
                    align: 'start',
                    font: {
                        size: 14,
                        weight: '400'
                    },
                    color: '#6b7280',
                    padding: {
                        bottom: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: {
                        size: 13
                    },
                    bodyFont: {
                        size: 12
                    },
                    callbacks: {
                        title: function(context) {
                            const dayNum = context[0].dataIndex + 1;
                            const date = new Date(currentYear, currentMonth, dayNum);
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        font: {
                            size: 11
                        },
                        color: '#6b7280'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    },
                    border: {
                        display: false
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 11
                        },
                        color: '#6b7280',
                        maxRotation: 0,
                        autoSkip: false
                    },
                    border: {
                        display: false
                    }
                }
            }
        }
    });
}

// Check daily reminder
function checkDailyReminder() {
    const lastLogin = localStorage.getItem('lastLogin');
    const today = new Date().toDateString();

    // Show reminder if this is the first login today
    if (lastLogin !== today) {
        localStorage.setItem('lastLogin', today);
        // Use setTimeout to ensure modal can be displayed after DOM is fully ready
        setTimeout(() => {
            showDailyReminder();
        }, 100);
    } else {
        // Debug: Log if reminder was skipped (already shown today)
        console.log('Daily reminder already shown today. Last login:', lastLogin, 'Today:', today);
    }
}

// Force show daily reminder (for testing/debugging)
// Call this from browser console: forceShowDailyReminder()
window.forceShowDailyReminder = function() {
    showDailyReminder();
};

// Show daily reminder
function showDailyReminder() {
    const modal = document.getElementById('dailyReminderModal');
    const content = document.getElementById('reminderContent');
    
    // Check if modal elements exist
    if (!modal) {
        console.error('Daily reminder modal element not found');
        return;
    }
    if (!content) {
        console.error('Daily reminder content element not found');
        return;
    }
    
    console.log('Showing daily reminder modal. Tasks loaded:', allTasks.length);
    
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    
    const upcomingTasks = allTasks.filter(task => {
        if (task.completed || task.archived) {
            return false;
        }
        
        const taskDate = new Date(task.deadline);
        const taskDay = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
        
        // Check if task deadline is today
        if (taskDay >= todayStart && taskDay < todayEnd) {
            return true;
        }
        
        // Check if this is a recurring task that occurs today
        if (task.recurring && ['daily', 'weekly', 'monthly'].includes(task.recurring)) {
            return isRecurringTaskOnDate(task, todayStart);
        }
        
        return false;
    });

    if (upcomingTasks.length === 0) {
        content.innerHTML = `
            <div class="reminder-empty">
                <i class="fas fa-check-circle"></i>
                <h3>No tasks due today!</h3>
                <p>Enjoy your day! 🎉</p>
            </div>
        `;
    } else {
        content.innerHTML = `
            <p style="margin-bottom: 20px; text-align: center; color: var(--text-secondary);">
                You have <strong>${upcomingTasks.length}</strong> task${upcomingTasks.length > 1 ? 's' : ''} due today:
            </p>
            ${upcomingTasks.map(task => `
                <div class="reminder-task ${task.priority}">
                    <h4>${escapeHtml(task.title)}</h4>
                    <p>
                        <i class="fas fa-flag"></i> ${capitalizeFirst(task.priority)} Priority &nbsp;|&nbsp;
                        <i class="fas fa-clock"></i> ${formatTime(task.deadline)}
                    </p>
                </div>
            `).join('')}
        `;
    }

    // Show the modal
    modal.classList.add('active');
    console.log('Modal active class added. Modal element:', modal);
    
    // Ensure modal is visible (in case CSS needs a moment)
    setTimeout(() => {
        if (!modal.classList.contains('active')) {
            modal.classList.add('active');
            console.log('Modal active class re-added after timeout');
        }
        // Verify modal is actually visible
        const isVisible = window.getComputedStyle(modal).display !== 'none';
        console.log('Modal visibility check:', isVisible ? 'visible' : 'hidden');
    }, 50);
}

// Logout
async function logout(event) {
    const button = event ? event.target.closest('button') : document.getElementById('logoutBtn');
    if (button) setButtonLoading(button, true);

    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Error logging out:', error);
        showNotification('Error logging out', 'error');
        if (button) setButtonLoading(button, false);
    }
}

// Utility functions
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Check if a recurring task occurs on a specific date
// This function is used across the application for checking recurring task occurrences
function isRecurringTaskOnDate(task, checkDate) {
    // Validate inputs
    if (!task || !task.recurring || !checkDate) {
        return false;
    }
    
    // Only handle valid recurring types
    if (!['daily', 'weekly', 'monthly'].includes(task.recurring)) {
        return false;
    }
    
    const taskDeadline = new Date(task.deadline);
    const checkDateStart = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
    const taskDeadlineStart = new Date(taskDeadline.getFullYear(), taskDeadline.getMonth(), taskDeadline.getDate());
    
    // Don't show recurring for dates before the original deadline
    if (checkDateStart < taskDeadlineStart) {
        return false;
    }
    
    // IMPORTANT: Completed recurring tasks should not show as recurring
    // When a recurring task is completed, a new recurring task is created for the next period
    // The completed task should only show on its original deadline date, not as a recurring occurrence
    if (task.completed) {
        // Only show on the exact original deadline date
        return checkDateStart.getTime() === taskDeadlineStart.getTime();
    }
    
    // Handle different recurring types
    switch (task.recurring) {
        case 'daily':
            // Daily tasks occur every day on or after the deadline
            // Return true for any date on or after the deadline
            return checkDateStart >= taskDeadlineStart;
            
        case 'weekly':
            // Weekly tasks occur on the same day of week as the original deadline, every 7 days
            // Must be on or after the deadline date
            if (checkDateStart < taskDeadlineStart) {
                return false;
            }
            
            // Must be the same day of week (Sunday=0, Monday=1, etc.)
            if (taskDeadline.getDay() !== checkDate.getDay()) {
                return false;
            }
            
            // Calculate days difference
            const daysDiff = Math.floor((checkDateStart - taskDeadlineStart) / (1000 * 60 * 60 * 24));
            
            // Must be a multiple of 7 days (0, 7, 14, 21, etc.)
            // This ensures it's exactly 1 week, 2 weeks, 3 weeks, etc. after the deadline
            return daysDiff % 7 === 0;
            
        case 'monthly':
            // Monthly tasks occur on the same day of month as the original deadline, every month
            // Must be on or after the deadline date
            if (checkDateStart < taskDeadlineStart) {
                return false;
            }
            
            // Must be the same day of month
            if (taskDeadline.getDate() !== checkDate.getDate()) {
                return false;
            }
            
            // Calculate if it's a valid monthly occurrence
            // A task due on Jan 15 should recur on Feb 15, Mar 15, Apr 15, etc.
            const deadlineMonth = taskDeadline.getMonth();
            const deadlineYear = taskDeadline.getFullYear();
            const checkMonth = checkDate.getMonth();
            const checkYear = checkDate.getFullYear();
            
            // Must be in the same month or a later month
            if (checkYear < deadlineYear) {
                return false;
            }
            if (checkYear === deadlineYear && checkMonth < deadlineMonth) {
                return false;
            }
            
            // Calculate months difference
            const monthsDiff = (checkYear - deadlineYear) * 12 + (checkMonth - deadlineMonth);
            
            // Must be at least 0 months (same month or later)
            // This allows the task to show on its original deadline date and future monthly occurrences
            return monthsDiff >= 0;
            
        default:
            return false;
    }
}

function formatDate(date) {
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(date).toLocaleDateString('en-US', options);
}

function formatTime(date) {
    const options = { hour: '2-digit', minute: '2-digit' };
    return new Date(date).toLocaleTimeString('en-US', options);
}

function formatDateForInput(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        animation: slideInRight 0.3s ease-out;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

