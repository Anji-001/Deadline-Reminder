import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Button, Modal, TextInput, TouchableOpacity, ScrollView, RefreshControl, Share, Animated, StatusBar, SafeAreaView, Platform } from 'react-native';
import WebView from 'react-native-webview';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CookieManager from '@react-native-cookies/cookies';
import DateTimePicker from '@react-native-community/datetimepicker';
import notifee, { AuthorizationStatus, TimestampTrigger, TriggerType } from '@notifee/react-native';
import { parseDeadlineString } from '../utils/parser';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import Reanimated, { FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import BootSplash from "react-native-bootsplash";
import {
  ArchiveBoxIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  Cog6ToothIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
  XCircleIcon,
} from 'react-native-heroicons/outline';

const DEFAULT_HEADER = "*UPCOMING DEADLINES:*";
const DEFAULT_ITEM = "*[{subject}]* _{desc}_\n*Due:* {date}\n*Left:* {left}";
const STORAGE_CUSTOM_DEADLINES = '@custom_deadlines';
const STORAGE_CACHED_FEELS = '@cached_feels_deadlines';
const DEADLINE_FILTERS = ['Assignments', 'Quizzes', 'Labs', 'Other'];

const parseSafeDate = (dateString) => {
  let targetDate = new Date(dateString);
  if (isNaN(targetDate)) {
    const parts = dateString.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)\s+(AM|PM)/i);
    if (parts) {
      const month = parseInt(parts[1], 10) - 1; 
      const day = parseInt(parts[2], 10);
      const year = parseInt(parts[3], 10);
      let hours = parseInt(parts[4], 10);
      const minutes = parseInt(parts[5], 10);
      const ampm = parts[6].toUpperCase();
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      targetDate = new Date(year, month, day, hours, minutes);
    }
  }
  return targetDate;
};

const normalizeCustomDeadlines = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    id: item.id || `${item.subject || ''}-${item.deadline || ''}`,
    source: 'custom',
  }));
};

const normalizeFeelsDeadlines = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    source: 'feels',
  }));
};

const getUrgencyStyle = (deadlineStr) => {
  const targetDate = parseSafeDate(deadlineStr);
  if (isNaN(targetDate)) return styles.cardSafe; 
  const diffMs = targetDate.getTime() - Date.now();
  if (diffMs < 0) return styles.cardOverdue; 
  if (diffMs < 24 * 60 * 60 * 1000) return styles.cardUrgent; 
  if (diffMs < 3 * 24 * 60 * 60 * 1000) return styles.cardWarning; 
  return styles.cardSafe; 
};

const getDeadlineCategory = (item) => {
  const text = `${item?.description || ''} ${item?.subject || ''}`.toLowerCase();
  if (text.includes('quiz')) return 'Quizzes';
  if (text.includes('lab')) return 'Labs';
  if (text.includes('assignment') || text.includes('assgn') || text.includes('hw') || text.includes('homework')) return 'Assignments';
  return 'Other';
};

const DashboardScreen = ({ onLogout }) => {
  const webviewRef = useRef(null);
  const [credentials, setCredentials] = useState(null);
  const [status, setStatus] = useState('Unlocking vault...');
  
  // States
  const [deadlines, setDeadlines] = useState([]);
  const [notes, setNotes] = useState([]); // ✨ NEW: Notes Array
  const [loginError, setLoginError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  const [refreshing, setRefreshing] = useState(false);
  const [reminderOffset, setReminderOffset] = useState('24');
  const [showSettings, setShowSettings] = useState(false);
  const [headerTemplate, setHeaderTemplate] = useState(DEFAULT_HEADER);
  const [itemTemplate, setItemTemplate] = useState(DEFAULT_ITEM);
  const [lastDeleted, setLastDeleted] = useState(null);
  const [deadlineFilters, setDeadlineFilters] = useState([]);

  const [dividerTemplate, setDividerTemplate] = useState('\n\n〰️〰️〰️〰️〰️〰️〰️〰️〰️\n\n');

  // Task Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [customDate, setCustomDate] = useState(new Date()); 
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('date');
  const [editingIndex, setEditingIndex] = useState(null);

  // ✨ NEW: Note Modal States ✨
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteTopic, setNoteTopic] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);

  let rowRefs = new Map();

  useEffect(() => {
    const loadData = async () => {
      // (Keep your existing Keychain and notification permission code here)
      await notifee.requestPermission();
      const creds = await Keychain.getGenericPassword();
      if (creds) { setCredentials(creds); setStatus('Connecting to FEeLS...'); } else { onLogout(); }
      
      // Load saved templates and notes
      try {
        const [savedHeader, savedItem, savedOffset, savedDivider, savedNotes] = await Promise.all([
          AsyncStorage.getItem('@header_template'),
          AsyncStorage.getItem('@item_template'),
          AsyncStorage.getItem('@reminder_offset'),
          AsyncStorage.getItem('@divider_template'),
          AsyncStorage.getItem('@saved_notes'),
        ]);

        if (savedHeader) setHeaderTemplate(savedHeader);
        if (savedItem) setItemTemplate(savedItem);
        if (savedOffset) setReminderOffset(savedOffset);
        if (savedDivider) setDividerTemplate(savedDivider);
        if (savedNotes) {
          const parsedNotes = JSON.parse(savedNotes);
          if (Array.isArray(parsedNotes)) setNotes(parsedNotes);
        }
      } catch (error) {
        console.error('Failed to load settings or notes', error);
      }

      // ✨ Load cached deadlines so the list isn't blank during sync ✨
      try {
        const [savedCustomStr, cachedFeelsStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_CUSTOM_DEADLINES),
          AsyncStorage.getItem(STORAGE_CACHED_FEELS),
        ]);

        const customDeadlines = normalizeCustomDeadlines(savedCustomStr ? JSON.parse(savedCustomStr) : []);
        const cachedFeels = normalizeFeelsDeadlines(cachedFeelsStr ? JSON.parse(cachedFeelsStr) : []);
        const combined = [...cachedFeels, ...customDeadlines];

        if (combined.length > 0) {
          combined.sort((a, b) => parseSafeDate(a.deadline) - parseSafeDate(b.deadline));
          setDeadlines(combined);
        }
      } catch (e) {
        console.error("Failed to load cached deadlines on boot", e);
      }
      
    };
    loadData();
  }, []);

  const saveTemplates = async () => {
    await AsyncStorage.setItem('@header_template', headerTemplate);
    await AsyncStorage.setItem('@item_template', itemTemplate);
    await AsyncStorage.setItem('@reminder_offset', reminderOffset);
    await AsyncStorage.setItem('@divider_template', dividerTemplate);
    
    setShowSettings(false); // Close the settings menu
    setSuccessMessage("Your settings have been saved successfully!"); // ✨ Trigger custom modal
  };

  const handleLogout = async () => {
    try {
      await CookieManager.clearAll(true);
      if (webviewRef.current?.clearCache) {
        webviewRef.current.clearCache(true);
      }
    } catch (error) {
      console.warn('Failed to clear FEeLS cookies', error);
    }

    onLogout();
  };

  // ✨ NEW: Notes Logic ✨
  const handleOpenNote = (note = null) => {
    if (note) {
      setEditingNoteId(note.id);
      setNoteTopic(note.topic);
      setNoteContent(note.content);
    } else {
      setEditingNoteId(null);
      setNoteTopic('');
      setNoteContent('');
    }
    setShowNoteModal(true);
  };

  const handleSaveNote = async () => {
    if (!noteTopic.trim()) return Alert.alert("Missing Topic", "Give your note a title!");
    
    let updatedNotes;
    if (editingNoteId) {
      updatedNotes = notes.map(n => n.id === editingNoteId ? { ...n, topic: noteTopic, content: noteContent } : n);
    } else {
      const newNote = { id: Date.now().toString(), topic: noteTopic, content: noteContent };
      updatedNotes = [newNote, ...notes]; // Put new notes at the front
    }
    
    setNotes(updatedNotes);
    await AsyncStorage.setItem('@saved_notes', JSON.stringify(updatedNotes));
    setShowNoteModal(false);
  };

  const handleDeleteNote = async () => {
    if (!editingNoteId) return setShowNoteModal(false);
    const updatedNotes = notes.filter(n => n.id !== editingNoteId);
    setNotes(updatedNotes);
    await AsyncStorage.setItem('@saved_notes', JSON.stringify(updatedNotes));
    setShowNoteModal(false);
  };

  // --- Task Logic (Unchanged) ---
  const scheduleDeadlineReminder = async (subject, description, deadlineDateString) => {
    const targetDate = parseSafeDate(deadlineDateString);
    if (isNaN(targetDate)) return;
    const offsetHours = parseInt(reminderOffset, 10) || 24; 
    const triggerTime = new Date(targetDate.getTime());
    triggerTime.setHours(triggerTime.getHours() - offsetHours);
    if (triggerTime.getTime() < Date.now()) return;

    const channelId = await notifee.createChannel({ id: 'deadline-reminders', name: 'Deadline Reminders' });
    const trigger = { type: TriggerType.TIMESTAMP, timestamp: triggerTime.getTime(), alarmManager: true };
    const notificationId = `${subject.replace(/\s+/g, '')}-${targetDate.getTime()}`;

    await notifee.createTriggerNotification(
      { id: notificationId, title: `🚨 Upcoming: ${subject}`, body: `${description} is due in ${offsetHours} hours. Don't forget!`, android: { channelId, pressAction: { id: 'default' } } },
      trigger
    );
  };

  const cancelAlarm = async (subject, deadlineDateString) => {
      const targetDate = parseSafeDate(deadlineDateString);
      if(isNaN(targetDate)) return;
      const notificationId = `${subject.replace(/\s+/g, '')}-${targetDate.getTime()}`;
      try { await notifee.cancelNotification(notificationId); } catch (error) {}
  };

  const handleRemoveDeadline = (indexToRemove) => {
    if (rowRefs.get(indexToRemove)) rowRefs.get(indexToRemove).close();
    const itemToDelete = deadlines[indexToRemove];
    cancelAlarm(itemToDelete.subject, itemToDelete.deadline).catch(e => {});
    setLastDeleted({ item: itemToDelete, index: indexToRemove });
    setDeadlines(prev => prev.filter((_, index) => index !== indexToRemove));
    if (itemToDelete?.source === 'custom') {
      removeCustomDeadline(itemToDelete.id);
    }
  };

  const handleUndo = () => {
    if (lastDeleted) {
      setDeadlines(prev => {
        const newList = [...prev];
        newList.splice(lastDeleted.index, 0, lastDeleted.item);
        return newList;
      });
      scheduleDeadlineReminder(lastDeleted.item.subject, lastDeleted.item.description, lastDeleted.item.deadline);
      if (lastDeleted.item?.source === 'custom') {
        upsertCustomDeadline({ ...lastDeleted.item, source: 'custom' });
      }
      setLastDeleted(null);
    }
  };

  const handleShare = async () => {
    if (deadlines.length === 0) return;
    const filteredDeadlines = deadlines.filter((item) => (
      deadlineFilters.length === 0 || deadlineFilters.includes(getDeadlineCategory(item))
    ));
    if (filteredDeadlines.length === 0) return;
    const formattedItems = filteredDeadlines.map(d => itemTemplate.replace(/{subject}/g, d.subject).replace(/{desc}/g, d.description).replace(/{date}/g, d.deadline).replace(/{left}/g, d.remaining));
    const shareText = `${headerTemplate}\n\n${formattedItems.join(dividerTemplate)}`;
    try { await Share.share({ message: shareText }); } catch (error) {}
  };

  const getFormattedDateString = (dateObj) => `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
  const getFormattedTimeString = (dateObj) => {
    let hours = dateObj.getHours();
    let minutes = dateObj.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  };

  const openPicker = (mode) => { setPickerMode(mode); setShowPicker(true); };
  const onChangePicker = (event, selectedDate) => { setShowPicker(false); if (selectedDate) setCustomDate(selectedDate); };

  const handleEditClick = (index) => {
      if (rowRefs.get(index)) rowRefs.get(index).close();
      const itemToEdit = deadlines[index];
      setEditingIndex(index);
      setNewSubject(itemToEdit.subject);
      setNewDesc(itemToEdit.description);
      const parsedDate = parseSafeDate(itemToEdit.deadline);
      setCustomDate(!isNaN(parsedDate) ? parsedDate : new Date());
      setTimeout(() => setShowAddModal(true), 150);
  };

  const handleSaveTask = async () => {
    if (!newSubject || !newDesc) return;
    const diffMs = customDate - new Date();
    let remaining = diffMs < 0 ? "Overdue" : `${Math.floor(diffMs / (1000 * 60 * 60 * 24))} days ${Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))} hours`;
    const deadlineStr = `${getFormattedDateString(customDate)} ${getFormattedTimeString(customDate)}`;
    const existingItem = editingIndex !== null ? deadlines[editingIndex] : null;
    const updatedItem = {
      subject: newSubject.toUpperCase(),
      description: newDesc,
      deadline: deadlineStr,
      remaining: remaining,
      id: existingItem?.id || `${newSubject.toUpperCase()}-${deadlineStr}`,
      source: existingItem?.source || 'custom',
    };

    if (editingIndex !== null) {
        const oldItem = deadlines[editingIndex];
        await cancelAlarm(oldItem.subject, oldItem.deadline);
        setDeadlines(prev => { const newList = [...prev]; newList[editingIndex] = updatedItem; return newList; });
        scheduleDeadlineReminder(updatedItem.subject, updatedItem.description, updatedItem.deadline);
        if (oldItem?.source === 'custom') {
          await upsertCustomDeadline({ ...updatedItem, source: 'custom' });
        }
    } else {
        setDeadlines(prev => {
          const newList = [...prev, updatedItem];
          newList.sort((a, b) => parseSafeDate(a.deadline) - parseSafeDate(b.deadline));
          return newList;
        });
        scheduleDeadlineReminder(updatedItem.subject, updatedItem.description, updatedItem.deadline);
        await upsertCustomDeadline({ ...updatedItem, source: 'custom' });
    }
    setShowAddModal(false); setNewSubject(''); setNewDesc(''); setCustomDate(new Date()); setEditingIndex(null); 
  };

  const handleOpenAdd = () => { setEditingIndex(null); setNewSubject(''); setNewDesc(''); setCustomDate(new Date()); setShowAddModal(true); };

  const toggleDeadlineFilter = (filter) => {
    setDeadlineFilters((prev) => {
      if (filter === 'All') return [];
      const exists = prev.includes(filter);
      const next = exists ? prev.filter((item) => item !== filter) : [...prev, filter];
      if (next.length === DEADLINE_FILTERS.length) return [];
      return next;
    });
  };

  const onRefresh = useCallback(() => { setRefreshing(true); setStatus('Refreshing FEeLS data...'); if (webviewRef.current) webviewRef.current.reload(); }, []);

  // ✨ NEW: Notice we added the 'async' keyword here! ✨
  const handleMessage = async (event) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);
      // ✨ NEW: Listen for the SOS message from the WebView
      if (parsed.type === 'LOGIN_FAILED') {
        setStatus('Login Failed!');
        setLoginError(parsed.message);
        return; // Stop processing anything else
      }

      if (parsed.type === 'SCRAPED_DATA') {
        
        // 1. ✨ FETCH CUSTOM DEADLINES FROM STORAGE FIRST ✨
        const savedCustomStr = await AsyncStorage.getItem(STORAGE_CUSTOM_DEADLINES);
        const customDeadlines = normalizeCustomDeadlines(savedCustomStr ? JSON.parse(savedCustomStr) : []);
        
        const rawArray = parsed.data || [];
        let structuredData = [];

        // 2. Process FEeLS data if there is any
        if (rawArray.length > 0) {
          structuredData = rawArray
            .map(item => parseDeadlineString(item))
            .filter(item => {
              const targetDate = parseSafeDate(item.deadline);
              if (isNaN(targetDate)) return true; 
              const msPastDeadline = Date.now() - targetDate.getTime();
              const oneDayMs = 24 * 60 * 60 * 1000;
              return msPastDeadline < oneDayMs;
            });
        }

        const feelsDeadlines = normalizeFeelsDeadlines(structuredData);

        await AsyncStorage.setItem(STORAGE_CACHED_FEELS, JSON.stringify(feelsDeadlines));

        // 3. ✨ COMBINE SCRAPED DATA WITH CUSTOM DATA ✨
        const combinedData = [...feelsDeadlines, ...customDeadlines];

        // 4. Sort and display the combined list
        if (combinedData.length > 0) {
          combinedData.sort((a, b) => {
            const dateA = parseSafeDate(a.deadline);
            const dateB = parseSafeDate(b.deadline);
            const timeA = isNaN(dateA) ? 0 : dateA.getTime();
            const timeB = isNaN(dateB) ? 0 : dateB.getTime();
            return timeA - timeB;
          });
          
          setDeadlines(combinedData);
          setStatus('Deadlines Synced'); 
          combinedData.forEach(item => scheduleDeadlineReminder(item.subject, item.description, item.deadline));
        } else { 
          setDeadlines([]); 
          setStatus('No actionable deadlines.'); 
        }
      }
    } catch (e) { 
      setStatus('Error loading data.'); 
    } finally { 
      setRefreshing(false); 
    }
  };

  const renderRightActions = (progress, dragX, index) => {
    const scale = dragX.interpolate({ inputRange: [-100, 0], outputRange: [1, 0], extrapolate: 'clamp' });
    return (
      <View style={styles.deleteSwipeBackground}>
        <TouchableOpacity onPress={() => handleRemoveDeadline(index)} style={styles.deleteSwipeBtn}>
          <Animated.Text style={[styles.swipeText, { transform: [{ scale }] }]}>Delete</Animated.Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderLeftActions = (progress, dragX, index) => {
    const scale = dragX.interpolate({ inputRange: [0, 100], outputRange: [0, 1], extrapolate: 'clamp' });
    return (
      <View style={styles.editSwipeBackground}>
        <TouchableOpacity onPress={() => handleEditClick(index)} style={styles.editSwipeBtn}>
          <Animated.Text style={[styles.swipeText, { transform: [{ scale }] }]}>Edit</Animated.Text>
        </TouchableOpacity>
      </View>
    );
  };

  const upsertCustomDeadline = async (deadline) => {
    try {
      const savedStr = await AsyncStorage.getItem(STORAGE_CUSTOM_DEADLINES);
      const existingDeadlines = normalizeCustomDeadlines(savedStr ? JSON.parse(savedStr) : []);
      const exists = existingDeadlines.some((item) => item.id === deadline.id);
      const updatedList = exists
        ? existingDeadlines.map((item) => (item.id === deadline.id ? deadline : item))
        : [...existingDeadlines, deadline];

      await AsyncStorage.setItem(STORAGE_CUSTOM_DEADLINES, JSON.stringify(updatedList));
      return updatedList;
    } catch (error) {
      console.error('Error saving custom deadline', error);
      return null;
    }
  };

  const removeCustomDeadline = async (deadlineId) => {
    try {
      const savedStr = await AsyncStorage.getItem(STORAGE_CUSTOM_DEADLINES);
      const existingDeadlines = normalizeCustomDeadlines(savedStr ? JSON.parse(savedStr) : []);
      const updatedList = existingDeadlines.filter((item) => item.id !== deadlineId);
      await AsyncStorage.setItem(STORAGE_CUSTOM_DEADLINES, JSON.stringify(updatedList));
    } catch (error) {
      console.error('Error removing custom deadline', error);
    }
  };

  if (!credentials) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8f9fa" />
      <GestureHandlerRootView style={styles.container}>
        
        {/* HEADER */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>FEeLs</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity onPress={handleShare} style={styles.iconBtn}><ShareIcon size={28} color="#111827" /></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}><Cog6ToothIcon size={30} color="#111827" /></TouchableOpacity>
          </View>
        </View>
        
        {/* STATUS */}
        <View style={styles.statusBox}>
          {status === 'Deadlines Synced' || status.includes('No actionable') || status.includes('No upcoming') 
            ? <CheckCircleIcon size={16} color="#16a34a" style={styles.statusIcon} /> : <ActivityIndicator size="small" color="#0066cc" style={{marginRight: 8}} />
          }
          <Text style={styles.statusText}>{status}</Text>
        </View>

        <ScrollView 
          contentContainerStyle={styles.scrollPadding} 
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0066cc']} />}
        >
          {/* ✨ NEW: TOPIC TILES (NOTES) SECTION ✨ */}
          <View style={styles.notesSection}>
            <Text style={styles.sectionTitle}>Quick Notes</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.notesScrollContainer}>
              
              {/* Add Note Button */}
              <TouchableOpacity style={styles.addNoteTile} onPress={() => handleOpenNote()}>
                <PlusIcon size={28} color="#9ca3af" style={styles.addNoteIcon} />
              </TouchableOpacity>

              {/* Saved Notes */}
              {notes.map((note) => (
                <Reanimated.View key={note.id} entering={ZoomIn.duration(200)} layout={LinearTransition.duration(200)}>
                  <TouchableOpacity style={styles.noteTile} onPress={() => handleOpenNote(note)}>
                    <Text style={styles.noteTopic} numberOfLines={1}>{note.topic}</Text>
                    <Text style={styles.noteContentPreview} numberOfLines={3}>{note.content}</Text>
                  </TouchableOpacity>
                </Reanimated.View>
              ))}
            </ScrollView>
          </View>

          <Text style={[styles.sectionTitle, {marginTop: 15, paddingHorizontal: 20}]}>Upcoming Deadlines</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <TouchableOpacity
              onPress={() => toggleDeadlineFilter('All')}
              style={[
                styles.filterChip,
                deadlineFilters.length === 0 && styles.filterChipActive,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  deadlineFilters.length === 0 && styles.filterTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {DEADLINE_FILTERS.map((filter) => {
              const isActive = deadlineFilters.includes(filter);
              return (
                <TouchableOpacity
                  key={filter}
                  onPress={() => toggleDeadlineFilter(filter)}
                  style={[styles.filterChip, isActive && styles.filterChipActive]}
                >
                  <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                    {filter}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* DEADLINES LIST */}
          {deadlines.length > 0 ? (
            deadlines.map((item, index) => (
              (deadlineFilters.length === 0 || deadlineFilters.includes(getDeadlineCategory(item))) ?
              <Reanimated.View key={item.subject + item.deadline} style={styles.cardWrapper} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
                <Swipeable
                  ref={ref => { if (ref && !rowRefs.get(index)) { rowRefs.set(index, ref); } }}
                  renderLeftActions={(progress, dragX) => renderLeftActions(progress, dragX, index)}
                  renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, index)}
                  onSwipeableLeftOpen={() => handleEditClick(index)}
                  onSwipeableRightOpen={() => handleRemoveDeadline(index)}
                  leftThreshold={70} rightThreshold={70} overshootRight={false} overshootLeft={false}
                  containerStyle={styles.swipeContainer}
                >
                  <View style={[styles.card, getUrgencyStyle(item.deadline)]}>
                    <View style={styles.cardHeader}>
                      <View style={styles.moduleBadge}><Text style={styles.moduleBadgeText}>{item.subject}</Text></View>
                    </View>
                    <Text style={styles.cardTask}>{item.description}</Text>
                    <View style={styles.cardFooter}>
                      <View style={styles.footerItem}><CalendarDaysIcon size={14} color="#6b7280" style={styles.footerIcon} /><Text style={styles.cardTime}>{item.deadline.split(' ')[0]}</Text></View>
                      <View style={styles.footerItem}>
                        <ClockIcon size={14} color="#6b7280" style={styles.footerIcon} />
                        <Text style={[styles.cardLeft, getUrgencyStyle(item.deadline) === styles.cardOverdue && {color: '#888'}]}>{item.remaining}</Text>
                      </View>
                    </View>
                  </View>
                </Swipeable>
              </Reanimated.View>
              : null
            ))
          ) : (
            <View style={styles.emptyState}>
              <ArchiveBoxIcon size={48} color="#9ca3af" style={styles.emptyStateIcon} />
              <Text style={styles.placeholderText}>No deadlines detected.</Text>
            </View>
          )}
        </ScrollView>

        <TouchableOpacity style={styles.fab} onPress={handleOpenAdd}><PlusIcon size={28} color="#fff" /></TouchableOpacity>

        {lastDeleted && (
          <Reanimated.View entering={FadeInDown.duration(300)} exiting={FadeOut.duration(200)} style={styles.undoWrapper}>
            <Swipeable
              onSwipeableOpen={() => setLastDeleted(null)} 
              renderLeftActions={() => <View style={{ flex: 1 }} />} renderRightActions={() => <View style={{ flex: 1 }} />}
              leftThreshold={50} rightThreshold={50}
            >
              <View style={styles.undoContainer}>
                <Text style={styles.undoText}>Task deleted</Text>
                <TouchableOpacity onPress={handleUndo}><Text style={styles.undoBtnText}>UNDO</Text></TouchableOpacity>
              </View>
            </Swipeable>
          </Reanimated.View>
        )}

        {/* --- ✨ NEW: NOTES MODAL ✨ --- */}
        <Modal visible={showNoteModal} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { height: '80%' }]}> 
              <View style={styles.noteModalHeader}>
                <Text style={styles.modalTitle}>{editingNoteId ? 'Edit Note' : 'New Note'}</Text>
                {editingNoteId && (
                  <TouchableOpacity onPress={handleDeleteNote} style={styles.trashBtn}>
                    <TrashIcon size={20} color="#111827" />
                  </TouchableOpacity>
                )}
              </View>

              <TextInput 
                style={styles.noteTopicInput} 
                value={noteTopic} 
                onChangeText={setNoteTopic} 
                placeholder="Topic (e.g. CO322 Passwords)" 
                placeholderTextColor="#9ca3af"
              />
              
              <TextInput 
                style={styles.noteContentInput} 
                value={noteContent} 
                onChangeText={setNoteContent} 
                placeholder="Start typing..." 
                placeholderTextColor="#9ca3af"
                multiline={true}
                textAlignVertical="top"
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setShowNoteModal(false)}>
                  <Text style={styles.cancelModalBtnText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveModalBtn} onPress={handleSaveNote}>
                  <Text style={styles.saveModalBtnText}>Save Note</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* --- TASK MODAL --- */}
        <Modal visible={showAddModal} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editingIndex !== null ? 'Edit Task' : 'Add Custom Task'}</Text>
              <Text style={styles.inputLabel}>Subject Code (e.g., CO322):</Text>
              <TextInput style={styles.input} value={newSubject} onChangeText={setNewSubject} placeholder="CO544" />
              <Text style={styles.inputLabel}>Description:</Text>
              <TextInput style={styles.input} value={newDesc} onChangeText={setNewDesc} placeholder="Hardware Project Report" />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                <View style={{ flex: 1, marginRight: 5 }}><Text style={styles.inputLabel}>Date:</Text><TouchableOpacity style={styles.pickerButton} onPress={() => openPicker('date')}><Text style={styles.pickerButtonText}>{getFormattedDateString(customDate)}</Text></TouchableOpacity></View>
                <View style={{ flex: 1, marginLeft: 5 }}><Text style={styles.inputLabel}>Time:</Text><TouchableOpacity style={styles.pickerButton} onPress={() => openPicker('time')}><Text style={styles.pickerButtonText}>{getFormattedTimeString(customDate)}</Text></TouchableOpacity></View>
              </View>
              {showPicker && <DateTimePicker value={customDate} mode={pickerMode} is24Hour={false} display="default" onChange={onChangePicker} />}
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelModalBtn} onPress={() => {setShowAddModal(false); setEditingIndex(null);}}><Text style={styles.cancelModalBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveModalBtn} onPress={handleSaveTask}><Text style={styles.saveModalBtnText}>{editingIndex !== null ? 'Save Changes' : 'Add Task'}</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* --- SETTINGS MODAL --- */}
        <Modal visible={showSettings} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Settings</Text>
              <Text style={styles.inputLabel}>Remind me X hours before:</Text>
              <TextInput style={styles.input} value={reminderOffset} onChangeText={setReminderOffset} keyboardType="number-pad"/>
              <Text style={styles.inputLabel}>Header Text (Share):</Text>
              <TextInput style={styles.input} value={headerTemplate} onChangeText={setHeaderTemplate} />
              <Text style={styles.inputLabel}>Item Format (Share):</Text>
              <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} multiline={true} value={itemTemplate} onChangeText={setItemTemplate} />
              <Text style={styles.inputLabel}>Divider (Share):</Text>
              <TextInput 
                style={[styles.input, { height: 60, textAlignVertical: 'top' }]} 
                multiline={true} 
                value={dividerTemplate} 
                onChangeText={setDividerTemplate} 
                placeholder="Leave blank for no line"
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setShowSettings(false)}><Text style={styles.cancelModalBtnText}>Close</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveModalBtn} onPress={saveTemplates}><Text style={styles.saveModalBtnText}>Save</Text></TouchableOpacity>
              </View>
              <View style={styles.dangerZone}>
                <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}><Text style={styles.logoutBtnText}>Logout & Clear Vault</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* --- ✨ NEW: CUSTOM LOGIN ERROR MODAL ✨ --- */}
        <Modal visible={!!loginError} animationType="fade" transparent={true}>
          <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <View style={[styles.modalContent, { width: '85%', borderRadius: 24, alignItems: 'center', padding: 30, paddingBottom: 30 }]}>
              
              <XCircleIcon size={64} color="#ef4444" style={{ marginBottom: 15 }} />
              <Text style={[styles.modalTitle, { textAlign: 'center', marginBottom: 10, fontSize: 24 }]}>Login Failed</Text>
              
              <Text style={{ fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 25, lineHeight: 22 }}>
                {loginError || "Your FEeLS username or password seems to be incorrect."}
              </Text>
              
              <TouchableOpacity
                style={{ 
                  width: '100%', 
                  backgroundColor: '#ef4444', 
                  paddingVertical: 15, 
                  borderRadius: 12, 
                  alignItems: 'center',
                  marginTop: 5
                }}
                onPress={() => {
                  setLoginError(null);
                  handleLogout(); // Kicks them back to the login screen
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                  Update Credentials
                </Text>
              </TouchableOpacity>

            </View>
          </View>
        </Modal>

        {/* --- ✨ NEW: CUSTOM SUCCESS MODAL ✨ --- */}
        <Modal visible={!!successMessage} animationType="fade" transparent={true}>
          <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <View style={[styles.modalContent, { width: '85%', borderRadius: 24, alignItems: 'center', padding: 30, paddingBottom: 30 }]}>
              
              {/* Green Success Icon */}
              <CheckCircleIcon size={64} color="#10b981" style={{ marginBottom: 15 }} />
              <Text style={[styles.modalTitle, { textAlign: 'center', marginBottom: 10, fontSize: 24 }]}>Saved!</Text>
              
              <Text style={{ fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 25, lineHeight: 22 }}>
                {successMessage}
              </Text>
              
              <TouchableOpacity
                style={{ 
                  width: '100%', 
                  backgroundColor: '#10b981', // Matching green color
                  paddingVertical: 15, 
                  borderRadius: 12, 
                  alignItems: 'center',
                  marginTop: 5
                }}
                onPress={() => setSuccessMessage(null)} // Closes the modal
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                  Awesome
                </Text>
              </TouchableOpacity>

            </View>
          </View>
        </Modal>

        <View style={{ width: 0, height: 0, opacity: 0 }}>
          <WebView
            ref={webviewRef} source={{ uri: 'https://feels.pdn.ac.lk/calendar/view.php?view=upcoming' }}
            onNavigationStateChange={(navState) => {
              const url = navState.url;
              if (navState.loading) return; 
              if (url.includes('login/index.php')) { 
                setStatus('Logging in...'); 
                webviewRef.current.injectJavaScript(`
                  setTimeout(function() {
                    // ✨ 1. Check if Moodle generated a red error alert
                    var errorAlert = document.querySelector('.alert-danger, .error, #loginerrormessage');
                    if (errorAlert && errorAlert.innerText.trim().length > 0) {
                      // Tell React Native to stop and show the error!
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'LOGIN_FAILED', 
                        message: errorAlert.innerText.trim()
                      }));
                      return; // Stop the script from trying to log in again
                    }

                    // ✨ 2. If no error, proceed with normal login
                    var u = document.getElementById('username') || document.querySelector('input[name="username"]');
                    var p = document.getElementById('password') || document.querySelector('input[name="password"]');
                    var b = document.getElementById('loginbtn') || document.querySelector('button[type="submit"]') || document.querySelector('[type="submit"]');
                    
                    if (u && p && b) {
                      u.value = '${credentials.username}';
                      p.value = '${credentials.password}';
                      b.click();
                    } else {
                      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ERROR', message: 'HTML elements not found.'}));
                    }
                  }, 1000);
                  true;
                `); 
              }
              else if (url.includes('my/') || url.includes('dashboard') || url === 'https://feels.pdn.ac.lk/' || url === 'https://feels.pdn.ac.lk/?' || url.includes('?redirect=')) { setStatus('Routing to calendar...'); webviewRef.current.injectJavaScript(`window.location.href = 'https://feels.pdn.ac.lk/calendar/view.php?view=upcoming';`); }
              else if (url.includes('calendar/view.php')) { setStatus('Scanning FEeLS...'); webviewRef.current.injectJavaScript(`setTimeout(function(){try{var e=document.querySelectorAll('.event, .calendar_event_course'),r=[];e.forEach(function(ev){if(ev.parentElement&&ev.parentElement.closest('.event, .calendar_event_course'))return;var t=ev.innerText.replace(/\\n/g,' ').trim();if(t&&!r.includes(t))r.push(t);});window.ReactNativeWebView.postMessage(JSON.stringify({type:'SCRAPED_DATA',data:r}));}catch(er){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR',message:er.message}));}},1500);true;`); }
            }}
            onMessage={handleMessage} 
            javaScriptEnabled={true}

            incognito={false}
            cacheEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={false}
            domStorageEnabled={true}
          />
        </View>
      </GestureHandlerRootView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8f9fa' },
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 15 : 10 },
  title: { fontSize: 28, fontWeight: '900', color: '#1a1a1a', letterSpacing: -0.5 },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 10, marginLeft: 5 },
  statusBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eef2ff', paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'center', borderRadius: 20, marginBottom: 15 },
  statusIcon: { marginRight: 8 },
  statusText: { fontSize: 14, color: '#3730a3', fontWeight: '600' },
  
  // ✨ NEW: Notes Styles ✨
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 10, letterSpacing: -0.3 },
  notesSection: { marginBottom: 10, paddingHorizontal: 20 },
  notesScrollContainer: { paddingBottom: 15, paddingRight: 20 },
  addNoteTile: { width: 130, height: 130, backgroundColor: '#f3f4f6', borderRadius: 16, borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  addNoteIcon: { marginTop: -2 },
  noteTile: { width: 130, height: 130, backgroundColor: '#fff', borderRadius: 16, padding: 15, marginRight: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3 },
  noteTopic: { fontSize: 15, fontWeight: 'bold', color: '#1f2937', marginBottom: 6 },
  noteContentPreview: { fontSize: 13, color: '#6b7280', lineHeight: 18 },

  filterRow: { paddingHorizontal: 20, paddingBottom: 10, gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  filterChipActive: { backgroundColor: '#111827', borderColor: '#111827' },
  filterText: { color: '#4b5563', fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: '#fff' },

  scrollPadding: { paddingBottom: 100 }, 
  emptyState: { alignItems: 'center', marginTop: 30 },
  emptyStateIcon: { marginBottom: 15 },
  placeholderText: { color: '#666', fontSize: 16, fontWeight: 'bold' },
  
  cardWrapper: { marginBottom: 15, borderRadius: 16, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3, marginHorizontal: 20 },
  swipeContainer: { borderRadius: 16, overflow: 'hidden' }, 
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 16 },
  cardSafe: { borderLeftWidth: 6, borderLeftColor: '#3b82f6' }, 
  cardWarning: { borderLeftWidth: 6, borderLeftColor: '#f59e0b' }, 
  cardUrgent: { borderLeftWidth: 6, borderLeftColor: '#ef4444' }, 
  cardOverdue: { borderLeftWidth: 6, borderLeftColor: '#9ca3af', opacity: 0.7 }, 
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  moduleBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  moduleBadgeText: { fontSize: 12, fontWeight: 'bold', color: '#4b5563', textTransform: 'uppercase' },
  cardTask: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 15 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12 },
  footerItem: { flexDirection: 'row', alignItems: 'center' },
  footerIcon: { marginRight: 6 },
  cardTime: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  cardLeft: { fontSize: 13, color: '#10b981', fontWeight: '700' }, 
  
  deleteSwipeBackground: { backgroundColor: '#ef4444', justifyContent: 'center', flex: 1 },
  editSwipeBackground: { backgroundColor: '#3b82f6', justifyContent: 'center', flex: 1 },
  deleteSwipeBtn: { alignItems: 'flex-end', paddingRight: 25, width: '100%', height: '100%', justifyContent: 'center' },
  editSwipeBtn: { alignItems: 'flex-start', paddingLeft: 25, width: '100%', height: '100%', justifyContent: 'center' },
  swipeText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  
  fab: { position: 'absolute', bottom: 30, right: 20, backgroundColor: '#000', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 8 },
  
  undoWrapper: { position: 'absolute', bottom: 30, alignSelf: 'center', width: '70%', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
  undoContainer: { backgroundColor: '#333', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 25 },
  undoText: { color: '#fff', fontSize: 14 },
  undoBtnText: { color: '#fbbf24', fontWeight: 'bold', fontSize: 14 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 25, paddingBottom: 40, elevation: 10 },
  modalTitle: { fontSize: 22, fontWeight: '800', marginBottom: 20, color: '#111827' },
  
  // ✨ NEW: Note Modal Specific Styles ✨
  noteModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  trashBtn: { padding: 5 },
  noteTopicInput: { fontSize: 24, fontWeight: 'bold', color: '#111827', marginBottom: 15, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  noteContentInput: { flex: 1, fontSize: 16, color: '#374151', lineHeight: 24 },

  inputLabel: { fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 8, textTransform: 'uppercase' },
  input: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 15, marginBottom: 20, fontSize: 16, color: '#111827' },
  pickerButton: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 15, alignItems: 'center' },
  pickerButtonText: { fontSize: 16, color: '#111827', fontWeight: '600' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cancelModalBtn: { flex: 1, padding: 15, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center', marginRight: 10 },
  cancelModalBtnText: { color: '#4b5563', fontWeight: 'bold', fontSize: 16 },
  saveModalBtn: { flex: 1, padding: 15, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', marginLeft: 10 },
  saveModalBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  dangerZone: { marginTop: 30, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  logoutBtn: { backgroundColor: '#fef2f2', padding: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#fca5a5' },
  logoutBtnText: { color: '#ef4444', fontWeight: 'bold', fontSize: 16 },
});

export default DashboardScreen;