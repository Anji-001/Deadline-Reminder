import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Button, Modal, TextInput, TouchableOpacity, ScrollView, RefreshControl, Share, Animated, StatusBar, SafeAreaView } from 'react-native';
import WebView from 'react-native-webview';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import notifee, { AuthorizationStatus, TimestampTrigger, TriggerType } from '@notifee/react-native';
import { parseDeadlineString } from '../utils/parser';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import Reanimated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

const DEFAULT_HEADER = "*🚨 UPCOMING DEADLINES:*";
const DEFAULT_ITEM = "*[{subject}]* _{desc}_\n⏳ *Due:* {date}\n⏱️ *Left:* {left}";

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

const getUrgencyStyle = (deadlineStr) => {
  const targetDate = parseSafeDate(deadlineStr);
  if (isNaN(targetDate)) return styles.cardSafe; 
  const diffMs = targetDate.getTime() - Date.now();
  if (diffMs < 0) return styles.cardOverdue; 
  if (diffMs < 24 * 60 * 60 * 1000) return styles.cardUrgent; 
  if (diffMs < 3 * 24 * 60 * 60 * 1000) return styles.cardWarning; 
  return styles.cardSafe; 
};

const DashboardScreen = ({ onLogout }) => {
  const webviewRef = useRef(null);
  const [credentials, setCredentials] = useState(null);
  const [status, setStatus] = useState('Unlocking vault...');
  const [deadlines, setDeadlines] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
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
  const [editingIndex, setEditingIndex] = useState(null);

  let rowRefs = new Map();

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
      const savedOffset = await AsyncStorage.getItem('@reminder_offset');
      if (savedHeader) setHeaderTemplate(savedHeader);
      if (savedItem) setItemTemplate(savedItem);
      if (savedOffset) setReminderOffset(savedOffset);
    };
    loadData();
  }, []);

  const saveTemplates = async () => {
    await AsyncStorage.setItem('@header_template', headerTemplate);
    await AsyncStorage.setItem('@item_template', itemTemplate);
    await AsyncStorage.setItem('@reminder_offset', reminderOffset);
    setShowSettings(false);
    Alert.alert("Saved!", "Your settings have been saved.");
  };

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

  const handleRemoveDeadline = async (indexToRemove) => {
    if (rowRefs.get(indexToRemove)) rowRefs.get(indexToRemove).close();
    const itemToDelete = deadlines[indexToRemove];
    await cancelAlarm(itemToDelete.subject, itemToDelete.deadline);
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
      scheduleDeadlineReminder(lastDeleted.item.subject, lastDeleted.item.description, lastDeleted.item.deadline);
      setLastDeleted(null);
    }
  };

  const handleShare = async () => {
    if (deadlines.length === 0) return;
    const formattedItems = deadlines.map(d => itemTemplate.replace(/{subject}/g, d.subject).replace(/{desc}/g, d.description).replace(/{date}/g, d.deadline).replace(/{left}/g, d.remaining));
    const shareText = `${headerTemplate}\n\n${formattedItems.join('\n\n〰️〰️〰️〰️〰️〰️〰️〰️〰️\n\n')}`;
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
      setShowAddModal(true);
  };

  const handleSaveTask = async () => {
    if (!newSubject || !newDesc) return;
    const diffMs = customDate - new Date();
    let remaining = diffMs < 0 ? "Overdue 🚨" : `${Math.floor(diffMs / (1000 * 60 * 60 * 24))} days ${Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))} hours`;
    const deadlineStr = `${getFormattedDateString(customDate)} ${getFormattedTimeString(customDate)}`;
    const updatedItem = { subject: newSubject.toUpperCase(), description: newDesc, deadline: deadlineStr, remaining: remaining };

    if (editingIndex !== null) {
        const oldItem = deadlines[editingIndex];
        await cancelAlarm(oldItem.subject, oldItem.deadline);
        setDeadlines(prev => { const newList = [...prev]; newList[editingIndex] = updatedItem; return newList; });
        scheduleDeadlineReminder(updatedItem.subject, updatedItem.description, updatedItem.deadline);
    } else {
        setDeadlines(prev => {
          const newList = [...prev, updatedItem];
          newList.sort((a, b) => parseSafeDate(a.deadline) - parseSafeDate(b.deadline));
          return newList;
        });
        scheduleDeadlineReminder(updatedItem.subject, updatedItem.description, updatedItem.deadline);
    }
    setShowAddModal(false); setNewSubject(''); setNewDesc(''); setCustomDate(new Date()); setEditingIndex(null); 
  };

  const handleOpenAdd = () => { setEditingIndex(null); setNewSubject(''); setNewDesc(''); setCustomDate(new Date()); setShowAddModal(true); };

  const onRefresh = useCallback(() => { setRefreshing(true); setStatus('Refreshing FEeLS data...'); if (webviewRef.current) webviewRef.current.reload(); }, []);

  const handleMessage = (event) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);
      if (parsed.type === 'SCRAPED_DATA') {
        const rawArray = parsed.data;
        if (rawArray.length > 0) {
          const structuredData = rawArray.map(item => parseDeadlineString(item)).filter(item => !item.description.toLowerCase().includes('quiz'));
          if (structuredData.length > 0) {
            structuredData.sort((a, b) => parseSafeDate(a.deadline) - parseSafeDate(b.deadline));
            setDeadlines(structuredData);
            setStatus('Deadlines Synced'); 
            structuredData.forEach(item => scheduleDeadlineReminder(item.subject, item.description, item.deadline));
          } else { setDeadlines([]); setStatus('No actionable deadlines.'); }
        } else { setStatus('No upcoming deadlines.'); }
      }
    } catch (e) { setStatus('Error loading data.'); } finally { setRefreshing(false); }
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

  if (!credentials) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  // ✨ HERE IS THE UPDATED RETURN BLOCK WITH SafeAreaView and StatusBar ✨
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar 
        barStyle="dark-content" 
        backgroundColor="#f8f9fa" 
      />
      <GestureHandlerRootView style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>FEeLS</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity onPress={handleShare} style={styles.iconBtn}><Text style={styles.iconBtnText}>📤</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}><Text style={styles.iconBtnText}>⚙️</Text></TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.statusBox}>
          {status === 'Deadlines Synced' || status.includes('No actionable') || status.includes('No upcoming') 
            ? <Text style={styles.statusIcon}>✅</Text> 
            : <ActivityIndicator size="small" color="#0066cc" style={{marginRight: 8}} />
          }
          <Text style={styles.statusText}>{status}</Text>
        </View>

        <ScrollView 
          contentContainerStyle={styles.scrollPadding} 
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0066cc']} />}
        >
          {deadlines.length > 0 ? (
            deadlines.map((item, index) => (
              <Reanimated.View 
                key={item.subject + item.deadline} 
                style={styles.cardWrapper}
                entering={FadeInDown.duration(200)} 
                exiting={FadeOut.duration(150)}
                layout={LinearTransition.duration(200)} 
              >
                <Swipeable
                  ref={ref => { if (ref && !rowRefs.get(index)) { rowRefs.set(index, ref); } }}
                  renderLeftActions={(progress, dragX) => renderLeftActions(progress, dragX, index)}
                  renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, index)}
                  onSwipeableLeftOpen={() => handleEditClick(index)}
                  onSwipeableRightOpen={() => handleRemoveDeadline(index)}
                  leftThreshold={70} rightThreshold={70}
                  overshootRight={false} overshootLeft={false}
                  containerStyle={styles.swipeContainer}
                >
                  <View style={[styles.card, getUrgencyStyle(item.deadline)]}>
                    <View style={styles.cardHeader}>
                      <View style={styles.moduleBadge}>
                        <Text style={styles.moduleBadgeText}>{item.subject}</Text>
                      </View>
                    </View>
                    <Text style={styles.cardTask}>{item.description}</Text>
                    <View style={styles.cardFooter}>
                      <View style={styles.footerItem}>
                        <Text style={styles.footerIcon}>📅</Text>
                        <Text style={styles.cardTime}>{item.deadline.split(' ')[0]}</Text>
                      </View>
                      <View style={styles.footerItem}>
                        <Text style={styles.footerIcon}>⏳</Text>
                        <Text style={[styles.cardLeft, getUrgencyStyle(item.deadline) === styles.cardOverdue && {color: '#888'}]}>
                          {item.remaining}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Swipeable>
              </Reanimated.View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>👻</Text>
              <Text style={styles.placeholderText}>No deadlines detected.</Text>
              <Text style={styles.placeholderSub}>Pull down to refresh FEeLS data.</Text>
            </View>
          )}
        </ScrollView>

        <TouchableOpacity style={styles.fab} onPress={handleOpenAdd}>
          <Text style={styles.fabIcon}>+</Text>
        </TouchableOpacity>

        {lastDeleted && (
          <View style={styles.undoContainer}>
            <Text style={styles.undoText}>Task deleted</Text>
            <TouchableOpacity onPress={handleUndo}><Text style={styles.undoBtnText}>UNDO</Text></TouchableOpacity>
          </View>
        )}

        <Modal visible={showAddModal} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editingIndex !== null ? 'Edit Task' : 'Add Custom Task'}</Text>
              <Text style={styles.inputLabel}>Subject Code (e.g., CO322):</Text>
              <TextInput style={styles.input} value={newSubject} onChangeText={setNewSubject} placeholder="CO544" />
              <Text style={styles.inputLabel}>Description:</Text>
              <TextInput style={styles.input} value={newDesc} onChangeText={setNewDesc} placeholder="Hardware Project Report" />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                <View style={{ flex: 1, marginRight: 5 }}>
                  <Text style={styles.inputLabel}>Date:</Text>
                  <TouchableOpacity style={styles.pickerButton} onPress={() => openPicker('date')}><Text style={styles.pickerButtonText}>{getFormattedDateString(customDate)}</Text></TouchableOpacity>
                </View>
                <View style={{ flex: 1, marginLeft: 5 }}>
                  <Text style={styles.inputLabel}>Time:</Text>
                  <TouchableOpacity style={styles.pickerButton} onPress={() => openPicker('time')}><Text style={styles.pickerButtonText}>{getFormattedTimeString(customDate)}</Text></TouchableOpacity>
                </View>
              </View>
              {showPicker && <DateTimePicker value={customDate} mode={pickerMode} is24Hour={false} display="default" onChange={onChangePicker} />}
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelModalBtn} onPress={() => {setShowAddModal(false); setEditingIndex(null);}}>
                  <Text style={styles.cancelModalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveModalBtn} onPress={handleSaveTask}>
                  <Text style={styles.saveModalBtnText}>{editingIndex !== null ? 'Save Changes' : 'Add Task'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

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
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setShowSettings(false)}>
                  <Text style={styles.cancelModalBtnText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveModalBtn} onPress={saveTemplates}>
                  <Text style={styles.saveModalBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.dangerZone}>
                <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
                  <Text style={styles.logoutBtnText}>Logout & Clear Vault</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <View style={{ width: 0, height: 0, opacity: 0 }}>
          <WebView
            ref={webviewRef}
            source={{ uri: 'https://feels.pdn.ac.lk/calendar/view.php?view=upcoming' }}
            onNavigationStateChange={(navState) => {
              const url = navState.url;
              if (navState.loading) return; 
              if (url.includes('login/index.php')) { setStatus('Logging in...'); webviewRef.current.injectJavaScript(`setTimeout(function(){var u=document.getElementById('username')||document.querySelector('input[name="username"]'),p=document.getElementById('password')||document.querySelector('input[name="password"]'),b=document.getElementById('loginbtn')||document.querySelector('button[type="submit"]')||document.querySelector('[type="submit"]');if(u&&p&&b){u.value='${credentials.username}';p.value='${credentials.password}';b.click();}else{window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR',message:'HTML elements not found.'}));}},1000);true;`); } 
              else if (url.includes('my/') || url.includes('dashboard') || url === 'https://feels.pdn.ac.lk/' || url === 'https://feels.pdn.ac.lk/?' || url.includes('?redirect=')) { setStatus('Routing to calendar...'); webviewRef.current.injectJavaScript(`window.location.href = 'https://feels.pdn.ac.lk/calendar/view.php?view=upcoming';`); }
              else if (url.includes('calendar/view.php')) { setStatus('Scanning FEeLS...'); webviewRef.current.injectJavaScript(`setTimeout(function(){try{var e=document.querySelectorAll('.event, .calendar_event_course'),r=[];e.forEach(function(ev){if(ev.parentElement&&ev.parentElement.closest('.event, .calendar_event_course'))return;var t=ev.innerText.replace(/\\n/g,' ').trim();if(t&&!r.includes(t))r.push(t);});window.ReactNativeWebView.postMessage(JSON.stringify({type:'SCRAPED_DATA',data:r}));}catch(er){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR',message:er.message}));}},1500);true;`); }
            }}
            onMessage={handleMessage}
            javaScriptEnabled={true} domStorageEnabled={true} sharedCookiesEnabled={true} thirdPartyCookiesEnabled={true}
          />
        </View>
      </GestureHandlerRootView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8f9fa' },
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 15, paddingTop: 10 },
  title: { fontSize: 28, fontWeight: '900', color: '#1a1a1a', letterSpacing: -0.5 },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 10, marginLeft: 5 },
  iconBtnText: { fontSize: 22 },
  statusBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eef2ff', paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'center', borderRadius: 20, marginBottom: 15 },
  statusIcon: { marginRight: 8, fontSize: 14 },
  statusText: { fontSize: 14, color: '#3730a3', fontWeight: '600' },
  scrollPadding: { paddingHorizontal: 20, paddingBottom: 100 }, 
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyStateIcon: { fontSize: 50, marginBottom: 15, opacity: 0.5 },
  placeholderText: { color: '#666', fontSize: 18, fontWeight: 'bold' },
  placeholderSub: { color: '#999', fontSize: 14, marginTop: 5 },
  cardWrapper: { marginBottom: 15, borderRadius: 16, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3 },
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
  footerIcon: { fontSize: 14, marginRight: 6 },
  cardTime: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  cardLeft: { fontSize: 13, color: '#10b981', fontWeight: '700' }, 
  deleteSwipeBackground: { backgroundColor: '#ef4444', justifyContent: 'center', flex: 1 },
  editSwipeBackground: { backgroundColor: '#3b82f6', justifyContent: 'center', flex: 1 },
  deleteSwipeBtn: { alignItems: 'flex-end', paddingRight: 25, width: '100%', height: '100%', justifyContent: 'center' },
  editSwipeBtn: { alignItems: 'flex-start', paddingLeft: 25, width: '100%', height: '100%', justifyContent: 'center' },
  swipeText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  fab: { position: 'absolute', bottom: 30, right: 20, backgroundColor: '#000', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 8 },
  fabIcon: { color: '#fff', fontSize: 32, fontWeight: '300', marginTop: -2 },
  undoContainer: { position: 'absolute', bottom: 30, alignSelf: 'center', backgroundColor: '#333', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 25, width: '70%', elevation: 6 },
  undoText: { color: '#fff', fontSize: 14 },
  undoBtnText: { color: '#fbbf24', fontWeight: 'bold', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 25, paddingBottom: 40, elevation: 10 },
  modalTitle: { fontSize: 22, fontWeight: '800', marginBottom: 20, color: '#111827' },
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