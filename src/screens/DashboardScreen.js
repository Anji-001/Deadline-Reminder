import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Button, Modal, TextInput, TouchableOpacity, ScrollView, RefreshControl, Share } from 'react-native';
import WebView from 'react-native-webview';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import notifee, { AuthorizationStatus, TimestampTrigger, TriggerType } from '@notifee/react-native';
import { parseDeadlineString } from '../utils/parser';

const DEFAULT_HEADER = "*🚨 UPCOMING DEADLINES:*";
const DEFAULT_ITEM = "*[{subject}]* _{desc}_\n⏳ *Due:* {date}\n⏱️ *Left:* {left}";

const DashboardScreen = ({ onLogout }) => {
  const webviewRef = useRef(null);
  const [credentials, setCredentials] = useState(null);
  const [status, setStatus] = useState('Unlocking vault...');
  const [deadlines, setDeadlines] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // ✨ NEW: Reminder Offset State (Default 24 hours) ✨
  const [reminderOffset, setReminderOffset] = useState('24');

  const [showSettings, setShowSettings] = useState(false);
  const [headerTemplate, setHeaderTemplate] = useState(DEFAULT_HEADER);
  const [itemTemplate, setItemTemplate] = useState(DEFAULT_ITEM);
  const [lastDeleted, setLastDeleted] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [customDate, setCustomDate] = useState(new Date()); 
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('date');

  useEffect(() => {
    const loadData = async () => {
      const settings = await notifee.requestPermission();
      if (settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED) {
        console.log('Notification permissions granted.');
      }

      const creds = await Keychain.getGenericPassword();
      if (creds) {
        setCredentials(creds);
        setStatus('Connecting to FEeLS...');
      } else {
        onLogout();
      }

      const savedHeader = await AsyncStorage.getItem('@header_template');
      const savedItem = await AsyncStorage.getItem('@item_template');
      const savedOffset = await AsyncStorage.getItem('@reminder_offset'); // ✨ LOAD OFFSET
      
      if (savedHeader) setHeaderTemplate(savedHeader);
      if (savedItem) setItemTemplate(savedItem);
      if (savedOffset) setReminderOffset(savedOffset);
    };
    loadData();
  }, []);

  const saveTemplates = async () => {
    await AsyncStorage.setItem('@header_template', headerTemplate);
    await AsyncStorage.setItem('@item_template', itemTemplate);
    await AsyncStorage.setItem('@reminder_offset', reminderOffset); // ✨ SAVE OFFSET
    setShowSettings(false);
    Alert.alert("Saved!", "Your settings have been saved.");
  };

  // ✨ UPGRADED: Hermes-Safe Math Engine ✨
  const scheduleDeadlineReminder = async (subject, description, deadlineDateString) => {
    let targetDate = new Date(deadlineDateString);

    // If Hermes panics at the string, we parse the numbers manually!
    if (isNaN(targetDate)) {
      // Hunts for our exact format: "MM/DD/YYYY HH:MM AM"
      const parts = deadlineDateString.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)\s+(AM|PM)/i);
      if (parts) {
        const month = parseInt(parts[1], 10) - 1; // JS Months are 0-indexed
        const day = parseInt(parts[2], 10);
        const year = parseInt(parts[3], 10);
        let hours = parseInt(parts[4], 10);
        const minutes = parseInt(parts[5], 10);
        const ampm = parts[6].toUpperCase();

        // Convert to 24-hour time
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;

        targetDate = new Date(year, month, day, hours, minutes);
      }
    }

    // If it still fails, log an error so we aren't blind
    if (isNaN(targetDate)) {
      console.log(`❌ Failed to parse date for ${subject}: ${deadlineDateString}`);
      return;
    }

    // Use the user's custom offset (fallback to 24)
    const offsetHours = parseInt(reminderOffset, 10) || 24; 
    
    const triggerTime = new Date(targetDate.getTime());
    triggerTime.setHours(triggerTime.getHours() - offsetHours);

    // Cancel if the reminder time is in the past!
    if (triggerTime.getTime() < Date.now()) {
        console.log(`⚠️ Skipped scheduling for ${subject} - Reminder time (${triggerTime.toLocaleString()}) already passed.`);
        return;
    }

    const channelId = await notifee.createChannel({
      id: 'deadline-reminders',
      name: 'Deadline Reminders',
    });

    const trigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerTime.getTime(), 
      alarmManager: true, // Forces precise timing on Android
    };

    const notificationId = `${subject.replace(/\s+/g, '')}-${targetDate.getTime()}`;

    await notifee.createTriggerNotification(
      {
        id: notificationId,
        title: `🚨 Upcoming: ${subject}`,
        body: `${description} is due in ${offsetHours} hours. Don't forget!`,
        android: { 
          channelId,
          pressAction: { id: 'default' } 
        },
      },
      trigger,
    );
    console.log(`✅ Alarm scheduled for: ${subject} to fire at ${triggerTime.toLocaleString()}`);
  };
  
  const handleRemoveDeadline = async (indexToRemove) => {
    const itemToDelete = deadlines[indexToRemove];
    const targetDate = new Date(itemToDelete.deadline);
    
    // Exact same ID formula as the creator
    const notificationId = `${itemToDelete.subject.replace(/\s+/g, '')}-${targetDate.getTime()}`;

    try {
      await notifee.cancelNotification(notificationId);
      console.log(`Alarm cancelled for: ${itemToDelete.subject}`);
    } catch (error) {
      console.log("Could not cancel alarm", error);
    }

    setLastDeleted({ item: itemToDelete, index: indexToRemove });
    setDeadlines(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleUndo = () => {
    if (lastDeleted) {
      setDeadlines(prev => {
        const newList = [...prev];
        newList.splice(lastDeleted.index, 0, lastDeleted.item);
        return newList;
      });
      // Re-schedule!
      scheduleDeadlineReminder(lastDeleted.item.subject, lastDeleted.item.description, lastDeleted.item.deadline);
      setLastDeleted(null);
    }
  };

  const handleShare = async () => {
    if (deadlines.length === 0) {
      Alert.alert("Nothing to share", "Wait for the deadlines to load first!");
      return;
    }
    const formattedItems = deadlines.map(d => {
      return itemTemplate
        .replace(/{subject}/g, d.subject)
        .replace(/{desc}/g, d.description)
        .replace(/{date}/g, d.deadline)
        .replace(/{left}/g, d.remaining);
    });
    const shareText = `${headerTemplate}\n\n${formattedItems.join('\n\n〰️〰️〰️〰️〰️〰️〰️〰️〰️\n\n')}`;
    try {
      await Share.share({ message: shareText });
    } catch (error) {
      Alert.alert("Error", "Could not open the share menu.");
    }
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

  const onChangePicker = (event, selectedDate) => {
    setShowPicker(false); 
    if (selectedDate) setCustomDate(selectedDate);
  };

  const openPicker = (mode) => {
    setPickerMode(mode);
    setShowPicker(true);
  };

  const handleAddCustomDeadline = () => {
    if (!newSubject || !newDesc) {
      Alert.alert("Missing Fields", "Please enter a subject and description.");
      return;
    }
    const diffMs = customDate - new Date();
    let remaining = diffMs < 0 ? "Overdue 🚨" : `${Math.floor(diffMs / (1000 * 60 * 60 * 24))} days ${Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))} hours`;
    
    const deadlineStr = `${getFormattedDateString(customDate)} ${getFormattedTimeString(customDate)}`;
    
    const newItem = {
      subject: newSubject.toUpperCase(),
      description: newDesc,
      deadline: deadlineStr,
      remaining: remaining
    };

    setDeadlines(prev => [...prev, newItem]);
    scheduleDeadlineReminder(newItem.subject, newItem.description, newItem.deadline);
    setShowAddModal(false);
    setNewSubject('');
    setNewDesc('');
    setCustomDate(new Date()); 
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setStatus('Refreshing FEeLS data...');
    if (webviewRef.current) webviewRef.current.reload();
  }, []);

  const getAutoLoginScript = () => `
    setTimeout(function() {
      var userField = document.getElementById('username') || document.querySelector('input[name="username"]');
      var passField = document.getElementById('password') || document.querySelector('input[name="password"]');
      var loginBtn = document.getElementById('loginbtn') || document.querySelector('button[type="submit"]') || document.querySelector('[type="submit"]');
      if (userField && passField && loginBtn) {
        userField.value = '${credentials.username}';
        passField.value = '${credentials.password}';
        loginBtn.click();
      } else {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'HTML elements not found.' }));
      }
    }, 1000);
    true;
  `;

  const scrapeCalendarScript = `
    setTimeout(function() {
      try {
        var events = document.querySelectorAll('.event, .calendar_event_course'); 
        var results = [];
        events.forEach(function(evt) {
          if (evt.parentElement && evt.parentElement.closest('.event, .calendar_event_course')) return;
          var rawText = evt.innerText.replace(/\\n/g, ' ').trim();
          if (rawText && !results.includes(rawText)) results.push(rawText);
        });
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SCRAPED_DATA', data: results }));
      } catch (err) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: err.message }));
      }
    }, 1500); 
    true;
  `;

  const handleNavigation = (navState) => {
    const url = navState.url;
    if (navState.loading) return; 
    if (url.includes('login/index.php')) {
      setStatus('Logging in automatically...');
      webviewRef.current.injectJavaScript(getAutoLoginScript());
    } 
    else if (url.includes('my/') || url.includes('dashboard') || url === 'https://feels.pdn.ac.lk/' || url === 'https://feels.pdn.ac.lk/?' || url.includes('?redirect=')) {
      setStatus('Success! Routing to calendar...');
      webviewRef.current.injectJavaScript(`window.location.href = 'https://feels.pdn.ac.lk/calendar/view.php?view=upcoming';`);
    }
    else if (url.includes('calendar/view.php')) {
      setStatus('Scanning for deadlines...');
      webviewRef.current.injectJavaScript(scrapeCalendarScript);
    }
  };

  const handleMessage = (event) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);
      if (parsed.type === 'SCRAPED_DATA') {
        const rawArray = parsed.data;
        if (rawArray.length > 0) {
          const structuredData = rawArray
            .map(item => parseDeadlineString(item))
            .filter(item => !item.description.toLowerCase().includes('quiz'));
          
          if (structuredData.length > 0) {
            setDeadlines(structuredData);
            setStatus('✅ Deadlines Extracted!');

            structuredData.forEach(item => {
              scheduleDeadlineReminder(item.subject, item.description, item.deadline);
            });

          } else {
            setDeadlines([]);
            setStatus('No actionable deadlines found.');
          }
        } else {
          setStatus('No upcoming deadlines found.');
        }
      }
    } catch (e) {
      console.log("Error parsing message", e);
      setStatus('Error loading data.');
    } finally {
      setRefreshing(false);
    }
  };

  if (!credentials) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>FEeLS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.headerButtons}>
          {lastDeleted && (
            <TouchableOpacity onPress={handleUndo} style={[styles.actionBtn, styles.undoBtn]}>
              <Text style={styles.actionBtnText}>↩️ Undo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setShowAddModal(true)} style={[styles.actionBtn, styles.addBtn]}>
            <Text style={[styles.actionBtnText, styles.addBtnText]}>➕ Add</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={[styles.actionBtn, styles.shareBtn]}>
            <Text style={[styles.actionBtnText, styles.shareBtnText]}>📤 Share</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
      
      <View style={styles.statusBox}>
        {status.includes('✅') || status.includes('No actionable') || status.includes('No upcoming') ? null : <ActivityIndicator color="#0066cc" />}
        <Text style={styles.statusText}>{status}</Text>
      </View>

      <ScrollView 
        style={styles.resultsBox}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0066cc']} />}
      >
        {deadlines.length > 0 ? (
          deadlines.map((item, index) => (
            <View key={index} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardSubject}>{item.subject}</Text>
                <TouchableOpacity onPress={() => handleRemoveDeadline(index)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.cardDesc}>{item.description}</Text>
              <Text style={styles.cardTime}>Due: {item.deadline}</Text>
              <Text style={styles.cardLeft}>Left: {item.remaining}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.placeholderText}>Pull down to load data...</Text>
        )}
      </ScrollView>

      <View style={{ marginTop: 10 }}>
        <Button title="Logout & Clear Vault" onPress={onLogout} color="#ff3b30" />
      </View>

      <Modal visible={showAddModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Custom Task</Text>
            <Text style={styles.inputLabel}>Subject Code (e.g., CO322):</Text>
            <TextInput style={styles.input} value={newSubject} onChangeText={setNewSubject} placeholder="CO544" />
            <Text style={styles.inputLabel}>Description:</Text>
            <TextInput style={styles.input} value={newDesc} onChangeText={setNewDesc} placeholder="Hardware Project Report" />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
              <View style={{ flex: 1, marginRight: 5 }}>
                <Text style={styles.inputLabel}>Select Date:</Text>
                <TouchableOpacity style={styles.pickerButton} onPress={() => openPicker('date')}>
                  <Text style={styles.pickerButtonText}>📅 {getFormattedDateString(customDate)}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, marginLeft: 5 }}>
                <Text style={styles.inputLabel}>Select Time:</Text>
                <TouchableOpacity style={styles.pickerButton} onPress={() => openPicker('time')}>
                  <Text style={styles.pickerButtonText}>⏰ {getFormattedTimeString(customDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {showPicker && (
              <DateTimePicker value={customDate} mode={pickerMode} is24Hour={false} display="default" onChange={onChangePicker} />
            )}
            <View style={styles.modalButtons}>
              <Button title="Cancel" onPress={() => setShowAddModal(false)} color="#999" />
              <Button title="Add Task" onPress={handleAddCustomDeadline} color="#28a745" />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showSettings} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Settings</Text>
            
            {/* ✨ NEW: Reminder Offset Input ✨ */}
            <Text style={styles.inputLabel}>Remind me X hours before:</Text>
            <TextInput 
              style={styles.input} 
              value={reminderOffset} 
              onChangeText={setReminderOffset} 
              keyboardType="number-pad"
            />

            <Text style={styles.inputLabel}>Header Text:</Text>
            <TextInput style={styles.input} value={headerTemplate} onChangeText={setHeaderTemplate} />
            <Text style={styles.inputLabel}>Item Format:</Text>
            <TextInput style={[styles.input, { height: 100, textAlignVertical: 'top' }]} multiline={true} value={itemTemplate} onChangeText={setItemTemplate} />
            <View style={styles.modalButtons}>
              <Button title="Cancel" onPress={() => setShowSettings(false)} color="#999" />
              <Button title="Save Settings" onPress={saveTemplates} color="#0066cc" />
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ width: 0, height: 0, opacity: 0 }}>
        <WebView
          ref={webviewRef}
          source={{ uri: 'https://feels.pdn.ac.lk/calendar/view.php?view=upcoming' }}
          onNavigationStateChange={handleNavigation}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5', paddingTop: 50 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#333' },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { backgroundColor: '#ddd', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginLeft: 8 },
  actionBtnText: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  undoBtn: { backgroundColor: '#ffc107' },
  shareBtn: { backgroundColor: '#0066cc' },
  shareBtnText: { color: '#fff' },
  addBtn: { backgroundColor: '#28a745' },
  addBtnText: { color: '#fff' },
  statusBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e6f2ff', padding: 15, borderRadius: 8, marginBottom: 15 },
  statusText: { marginLeft: 10, fontSize: 16, color: '#004080', fontWeight: '600' },
  resultsBox: { flex: 1, backgroundColor: '#fff', borderRadius: 8, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#ddd' },
  placeholderText: { color: '#999', fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
  card: { marginBottom: 15, borderBottomWidth: 1, borderColor: '#eee', paddingBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardSubject: { fontSize: 16, fontWeight: 'bold', color: '#004080' },
  removeBtn: { backgroundColor: '#ffe6e6', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  removeBtnText: { color: '#d9534f', fontSize: 12, fontWeight: 'bold' },
  cardDesc: { fontSize: 15, color: '#333', marginTop: 2 },
  cardTime: { fontSize: 14, color: '#d9534f', marginTop: 2 },
  cardLeft: { fontSize: 14, color: '#5cb85c', marginTop: 2, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', backgroundColor: '#fff', borderRadius: 10, padding: 20, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: '#333', textAlign: 'center' },
  modalSubtitle: { fontSize: 12, color: '#666', marginBottom: 20, textAlign: 'center' },
  inputLabel: { fontSize: 14, fontWeight: 'bold', color: '#444', marginBottom: 5 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 10, marginBottom: 15, fontSize: 14, color: '#333', backgroundColor: '#f9f9f9' },
  pickerButton: { backgroundColor: '#e6f2ff', padding: 12, borderRadius: 5, borderWidth: 1, borderColor: '#b3d9ff', alignItems: 'center' },
  pickerButtonText: { fontSize: 15, color: '#004080', fontWeight: 'bold' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }
});

export default DashboardScreen;